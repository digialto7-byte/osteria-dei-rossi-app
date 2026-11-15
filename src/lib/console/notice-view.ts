import { t } from "@/lib/i18n";
import { formatInstant } from "./console-dates";

/**
 * The sentence of a notice, or null for a kind this screen has no sentence for (the screen then shows the code).
 * It picks the singular or plural key itself because the sentence needs both {version} and {count}.
 */
export function noticeSentence(n: {
  kind: string;
  version: number;
  pending: readonly unknown[];
}): string | null {
  if (n.kind !== "subprocessor") return null;
  const count = n.pending.length;
  if (count === 0) return t("console.notices.subprocessor.done", { version: n.version });
  const key =
    count === 1 ? "console.notices.subprocessor.one" : "console.notices.subprocessor.other";
  return t(key, { version: n.version, count });
}

/** "Da leggere" holds the notices with someone still pending; the rest are "Letti". The order is kept. */
export function splitNotices<T extends { pending: readonly unknown[] }>(
  notices: readonly T[],
): { unread: T[]; read: T[] } {
  return {
    unread: notices.filter((n) => n.pending.length > 0),
    read: notices.filter((n) => n.pending.length === 0),
  };
}

export function notifiedLine(instant: string): string {
  return t("console.notices.notified", { date: formatInstant(instant) });
}
