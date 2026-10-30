import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { conflictMessage, lineLabel } from "@/lib/orders/order-view";
import { formatTime } from "@/lib/time/format";
import type { OrderLine } from "@/server/orders/output";
import type { OpError } from "@/server/sync/output";
import type { OutcomeRecord } from "./types";

// The words for what the server decided about a queued op (M20 plan §3.6.5): one notice per unseen conflict, refusal or dropped op, and
// one for a line a colleague changed after my applied edit. Pure; the component renders `text` as plain text (no markup is built).

export type NoticeKind = "conflict" | "rejected" | "dropped" | "overwritten";

export interface Notice {
  /** The first op id (or `overwritten:<lineId>`): a stable key. */
  id: string;
  /** Every outcome this notice stands for; "Ho capito" marks them all seen. */
  opIds: string[];
  kind: NoticeKind;
  sessionId: string;
  text: string;
}

interface Options {
  sessionId?: string;
  locale?: Locale;
}

/** The refusal in the person's language: the client has the catalogue, the server only sent its Italian default. */
function refusalText(error: OpError, locale: Locale): string {
  for (const key of [
    `orderError.${error.code}`,
    `tableError.${error.code}`,
    `syncError.${error.code}`,
  ]) {
    if (isMessageKey(key)) return t(key as MessageKey, {}, locale);
  }
  return error.message;
}

const dishOf = (o: OutcomeRecord) => o.label.dishName;
const tableOf = (o: OutcomeRecord) => o.label.tableName ?? "";

/** "2 × Spezzatino…" for more than one portion, else the name. */
function dishWithQty(o: OutcomeRecord, locale: Locale): string {
  const name = dishOf(o) ?? "";
  return o.label.qty !== undefined && o.label.qty !== 1
    ? lineLabel(o.label.qty, name, locale)
    : name;
}

function conflictText(o: OutcomeRecord, locale: Locale): string {
  const conflict = o.conflict!;
  const dish = dishOf(o) ?? tableOf(o);
  if (conflict.reason === "fired") return t("sync.notice.fired", { dish }, locale);
  const message = conflict.line
    ? conflictMessage(
        conflict.reason === "table_already_open" ? "session_closed" : conflict.reason,
        conflict.line,
        locale,
      )
    : t("orderError.session_closed", {}, locale);
  return t("sync.notice.named", { dish, message }, locale);
}

function rejectedText(o: OutcomeRecord, locale: Locale): string {
  const error = o.error!;
  if (error.code === "item_unavailable" && dishOf(o)) {
    return t("sync.notice.soldOut", { dish: dishOf(o)! }, locale);
  }
  const message = refusalText(error, locale);
  const dish = dishOf(o);
  return dish
    ? t("sync.notice.named", { dish, message }, locale)
    : t("sync.notice.table", { table: tableOf(o), message }, locale);
}

function droppedText(o: OutcomeRecord, locale: Locale): string {
  const dish = dishOf(o);
  return dish
    ? t("sync.notice.droppedDish", { dish }, locale)
    : t("sync.notice.droppedTable", { table: tableOf(o) }, locale);
}

/** Which kind of notice an outcome calls for, or null (applied, or already seen). A duplicate counts by what it stored. */
function kindOf(o: OutcomeRecord): NoticeKind | null {
  if (o.seen) return null;
  if (o.status === "dropped") return "dropped";
  if (o.status === "conflict" || (o.status === "duplicate" && o.conflict)) return "conflict";
  if (o.status === "rejected" || (o.status === "duplicate" && o.error)) return "rejected";
  return null;
}

export function noticesFor(outcomes: readonly OutcomeRecord[], options: Options = {}): Notice[] {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const ordered = [...outcomes].sort((a, b) => a.seq - b.seq);

  // A table that was already open folds in the ops dropped behind it (their dishes are listed in its notice).
  const reopened = new Set(
    ordered
      .filter((o) => kindOf(o) === "conflict" && o.conflict?.reason === "table_already_open")
      .map((o) => o.scope.sessionId),
  );
  const folded = (o: OutcomeRecord) =>
    o.status === "dropped" &&
    o.droppedReason === "session_not_created" &&
    reopened.has(o.scope.sessionId);

  const notices: Notice[] = [];
  for (const o of ordered) {
    const kind = kindOf(o);
    if (!kind || folded(o)) continue;
    let text: string;
    let opIds = [o.opId];
    if (kind === "conflict" && o.conflict!.reason === "table_already_open") {
      const behind = ordered.filter(
        (d) => folded(d) && d.scope.sessionId === o.scope.sessionId && !d.seen,
      );
      opIds = [o.opId, ...behind.map((d) => d.opId)];
      const dishes = behind.filter((d) => d.kind === "add_line").map((d) => dishWithQty(d, locale));
      text =
        dishes.length > 0
          ? t("sync.notice.tableOpen", { table: tableOf(o), dishes: dishes.join(", ") }, locale)
          : t("sync.notice.tableOpenBare", { table: tableOf(o) }, locale);
    } else if (kind === "conflict") {
      text = conflictText(o, locale);
    } else if (kind === "rejected") {
      text = rejectedText(o, locale);
    } else {
      text = droppedText(o, locale);
    }
    notices.push({ id: o.opId, opIds, kind, sessionId: o.scope.sessionId, text });
  }
  return options.sessionId === undefined
    ? notices
    : notices.filter((notice) => notice.sessionId === options.sessionId);
}

/**
 * AT5, second order: my edit was applied, and then a colleague's later stamp won. The line on the view has a stamp later than my
 * applied one and was last changed by someone else. One notice per line, covering all my applied edits of it.
 */
export function overwrittenNotices(
  outcomes: readonly OutcomeRecord[],
  lines: readonly Pick<OrderLine, "id" | "name" | "clientUpdatedAt" | "updatedAt" | "updatedBy">[],
  me: { id: string },
  locale: Locale = DEFAULT_LOCALE,
  sessionId?: string,
): Notice[] {
  const notices: Notice[] = [];
  for (const line of lines) {
    if (line.updatedBy.id === me.id) continue;
    const mine = outcomes.filter(
      (o) =>
        !o.seen &&
        o.kind === "edit_line" &&
        (o.status === "applied" || o.status === "duplicate") &&
        o.userId === me.id &&
        o.scope.lineId === line.id &&
        (sessionId === undefined || o.scope.sessionId === sessionId),
    );
    if (mine.length === 0) continue;
    const latest = Math.max(...mine.map((o) => Date.parse(o.clientTs)));
    if (!(Date.parse(line.clientUpdatedAt) > latest)) continue;
    notices.push({
      id: `overwritten:${line.id}`,
      opIds: mine.map((o) => o.opId),
      kind: "overwritten",
      sessionId: mine[0]!.scope.sessionId,
      text: t(
        "sync.notice.overwritten",
        {
          name: line.updatedBy.displayName,
          dish: line.name,
          time: formatTime(new Date(line.updatedAt), locale),
        },
        locale,
      ),
    });
  }
  return notices;
}
