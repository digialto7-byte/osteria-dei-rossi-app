"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Button, ErrorAlert, Field, Heading, Muted, TextInput } from "@/components/ui";
import { usePollWhile } from "@/components/use-poll-while";
import { useMe } from "@/components/use-me";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t, tn } from "@/lib/i18n";
import { dateFromQuery, dayHeading, type RowView } from "@/lib/reservations/day-view";
import { addDays } from "@/lib/time/venue-date";
import { comandaHref } from "@/lib/tables/comanda-url";
import { newSessionId } from "@/lib/tables/session-id";
import {
  RESERVATIONS_REFRESH_MS,
  type DeclineReason,
  type ReservationAction,
} from "@/server/reservations/constants";
import type {
  PendingCount,
  ReservationDetail,
  ReservationsDay,
  Suggestion,
  TableBooking,
  WaiterReservationsDay,
} from "@/server/reservations/output";
import type { MoveBody, StaffReservationBody, TablePickBody } from "@/server/reservations/schemas";
import { AcceptSheet } from "./accept-sheet";
import { DayView } from "./day-view";
import { DeclineSheet } from "./decline-sheet";
import { EraseSheet } from "./erase-sheet";
import { MoveSheet } from "./move-sheet";
import { NewReservationSheet } from "./new-reservation-sheet";
import { SeatSheet } from "./seat-sheet";

const FORBIDDEN = 403;
const PATH = "/prenotazioni";

type Day = ReservationsDay | WaiterReservationsDay;
type Panel =
  | { kind: "new" }
  | { kind: "accept" | "tables"; id: string }
  | { kind: "decline" | "move" | "seat" | "erase"; id: string };

// Whether the page is on screen: the day is read again every 60 seconds only while it is.
const onVisibility = (callback: () => void) => {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
};
const useVisible = () =>
  useSyncExternalStore(
    onVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );

/**
 * Prenotazioni (Sala): one business day by service, for owner, admin and waiter. Everything shown comes from /api/reservations (the status, the counts, the buttons of each
 * row, "unito a", the table suggestion); a write goes to /api/reservations/:id/... and then the day is read again. The day and the number of requests to answer are read every 60
 * seconds while the page is visible. Nothing is cached offline: bookings hold customers' data. The chef gets one notice.
 */
function ReservationsScreen({ date }: { date: string | null }) {
  const router = useRouter();
  const role = useMe().me?.user.role ?? null;
  const manager = role === "owner" || role === "admin";
  const [day, setDay] = useState<Day | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<ReservationDetail | null>(null);
  const [booking, setBooking] = useState<TableBooking | null>(null);
  // The tables a booking with none may be seated at, as the server lists them (null while they load).
  const [seatChoices, setSeatChoices] = useState<{ id: string; name: string }[] | null>(null);
  // One session id per booking, kept while the page lives: if open_table succeeded and its reply was lost, reopening the sheet retries with the same id (a replay).
  const [sessionIds, setSessionIds] = useState<Record<string, string>>({});
  const start = useRef(latestOnly()).current;
  const visible = useVisible();

  const load = useCallback(async () => {
    const isNewest = start();
    const query = date ? `?date=${date}` : "";
    const [read, count] = await Promise.all([
      apiJson<Day>(`/api/reservations${query}`),
      manager ? apiJson<PendingCount>("/api/reservations/pending-count") : Promise.resolve(null),
    ]);
    if (!isNewest()) return;
    if (!read.ok) {
      if (read.status === FORBIDDEN) setForbidden(true);
      else setLoadError(read.error.message);
      return;
    }
    setLoadError(null);
    setDay(read.data);
    if (count?.ok) setPending(count.data.pending);
  }, [date, manager, start]);

  useEffect(() => {
    // Loading the day when the page opens or the date changes is the effect's job here. The role is known after the first answer of /api/me.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (role !== null) void load();
  }, [load, role]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && role !== null) void load();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load, role]);

  usePollWhile(visible && role !== null, RESERVATIONS_REFRESH_MS, load);

  const rows = day?.services.flatMap((service) => service.reservations) ?? [];
  const rowOf = (id: string): RowView | null => rows.find((row) => row.id === id) ?? null;
  const services = (day?.services ?? []).map((service) => ({
    key: service.key,
    name: service.name,
  }));
  const shownDate = day?.businessDate ?? date;

  const close = () => {
    setPanel(null);
    setPanelError(null);
    setDetail(null);
  };

  /** One write; on success the day is read again and the panel closes. A failure stays on the panel (or the row) and nothing is read again. */
  async function write(
    key: string,
    path: string,
    body: unknown,
    target: "panel" | "row",
  ): Promise<boolean> {
    setBusy(key);
    setPanelError(null);
    setRowErrors(({ [key]: _gone, ...rest }) => rest);
    const result = await apiJson(path, { method: "POST", body });
    setBusy(null);
    if (!result.ok) {
      const message = result.error.message;
      if (target === "panel") setPanelError(message);
      else setRowErrors((current) => ({ ...current, [key]: message }));
      return false;
    }
    close();
    await load();
    return true;
  }

  async function onAction(row: RowView, action: ReservationAction) {
    setPanelError(null);
    if (action === "arrived" || action === "no_show") {
      return void write(row.id, `/api/reservations/${row.id}/mark`, { mark: action }, "row");
    }
    if (action === "split") {
      return void write(row.id, `/api/reservations/${row.id}/split`, {}, "row");
    }
    if (action === "decline" || action === "move" || action === "erase") {
      return setPanel({ kind: action, id: row.id });
    }
    if (action === "seat") {
      const fresh = newSessionId();
      setSessionIds((known) => (known[row.id] ? known : { ...known, [row.id]: fresh }));
      setPanel({ kind: "seat", id: row.id });
      setSeatChoices(null);
      if (row.leadTable === null) {
        // The choices are the database's (the detail's seatChoices): this screen filters nothing.
        const read = await apiJson<ReservationDetail>(`/api/reservations/${row.id}`);
        if (!read.ok) setPanelError(read.error.message);
        setSeatChoices(read.ok ? read.data.seatChoices : []);
      }
      return;
    }
    // accept and tables: the suggestion and the room's tables are read when the sheet opens.
    setPanel({ kind: action, id: row.id });
    setDetail(null);
    setBooking(null);
    const [read, tables] = await Promise.all([
      apiJson<ReservationDetail>(`/api/reservations/${row.id}`),
      apiJson<TableBooking>("/api/settings/reservations/tables"),
    ]);
    if (read.ok) setDetail(read.data);
    else setPanelError(read.error.message);
    if (tables.ok) setBooking(tables.data);
  }

  async function seat(row: RowView, sessionId: string, covers: number, tableId: string | null) {
    setBusy(row.id);
    setPanelError(null);
    const result = await apiJson<{ sessionId: string; created: boolean }>(
      `/api/reservations/${row.id}/seat`,
      { method: "POST", body: tableId ? { sessionId, covers, tableId } : { sessionId, covers } },
    );
    setBusy(null);
    if (!result.ok) return setPanelError(result.error.message);
    setSessionIds(({ [row.id]: _used, ...rest }) => rest);
    // Straight to the comanda of the session, as when a table is opened from Sala.
    router.push(comandaHref(result.data.sessionId));
  }

  function goTo(next: string | null) {
    router.replace(next ? `${PATH}?data=${next}` : PATH);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("reservations.page.title")}</Heading>
        <ErrorAlert message={t("reservations.page.forbidden")} />
      </>
    );
  }

  const active = panel && "id" in panel ? rowOf(panel.id) : null;
  const suggestion: Suggestion | null = detail?.suggestion ?? null;
  let sheet = null;
  if (panel?.kind === "new" && shownDate) {
    sheet = (
      <NewReservationSheet
        date={shownDate}
        services={services}
        busy={busy === "new"}
        error={panelError}
        onSubmit={(body: StaffReservationBody) =>
          void write("new", "/api/reservations", body, "panel")
        }
        onCancel={close}
      />
    );
  } else if (panel && active) {
    const id = active.id;
    if (panel.kind === "accept" || panel.kind === "tables") {
      sheet = (
        <AcceptSheet
          key={`${panel.kind}:${id}`}
          mode={panel.kind}
          row={active}
          suggestion={suggestion}
          booking={booking}
          loading={detail === null && panelError === null}
          loaded={detail !== null}
          busy={busy === id}
          error={panelError}
          onSubmit={(body: TablePickBody) =>
            void write(
              id,
              `/api/reservations/${id}/${panel.kind === "accept" ? "accept" : "tables"}`,
              body,
              "panel",
            )
          }
          onCancel={close}
        />
      );
    } else if (panel.kind === "decline") {
      sheet = (
        <DeclineSheet
          key={`decline:${id}`}
          row={active}
          busy={busy === id}
          error={panelError}
          onSubmit={(reason: DeclineReason) =>
            void write(id, `/api/reservations/${id}/decline`, { reason }, "panel")
          }
          onCancel={close}
        />
      );
    } else if (panel.kind === "move") {
      sheet = (
        <MoveSheet
          key={`move:${id}`}
          row={active}
          services={services}
          busy={busy === id}
          error={panelError}
          onSubmit={(body: MoveBody) =>
            void write(id, `/api/reservations/${id}/move`, body, "panel")
          }
          onCancel={close}
        />
      );
    } else if (panel.kind === "seat") {
      sheet = (
        <SeatSheet
          key={`seat:${id}`}
          row={active}
          sessionId={sessionIds[id] ?? ""}
          seatChoices={seatChoices}
          busy={busy === id}
          error={panelError}
          onSubmit={(sessionId, covers, tableId) => void seat(active, sessionId, covers, tableId)}
          onCancel={close}
        />
      );
    } else {
      sheet = (
        <EraseSheet
          key={`erase:${id}`}
          row={active}
          busy={busy === id}
          error={panelError}
          onConfirm={() => void write(id, `/api/reservations/${id}/erase-contact`, {}, "panel")}
          onCancel={close}
        />
      );
    }
  }

  return (
    <>
      <Heading>{t("reservations.page.title")}</Heading>
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="secondary" onClick={() => goTo(null)}>
          {t("reservations.today")}
        </Button>
        <Button
          variant="secondary"
          aria-label={t("reservations.prevDay")}
          disabled={shownDate === null}
          onClick={() => shownDate && goTo(addDays(shownDate, -1))}
        >
          ‹
        </Button>
        <Button
          variant="secondary"
          aria-label={t("reservations.nextDay")}
          disabled={shownDate === null}
          onClick={() => shownDate && goTo(addDays(shownDate, 1))}
        >
          ›
        </Button>
        <Field label={t("reservations.dayField")}>
          <TextInput
            name="reservationsDay"
            type="date"
            value={shownDate ?? ""}
            onChange={(event) => {
              if (event.target.value) goTo(event.target.value);
            }}
          />
        </Field>
      </div>
      {shownDate && <p className="num font-bold">{dayHeading(shownDate)}</p>}
      {pending !== null && pending > 0 && (
        <Badge tone="warning">{tn("reservations.pendingBadge", pending)}</Badge>
      )}
      <Button
        variant="primary"
        disabled={day === null}
        onClick={() => {
          setPanelError(null);
          setPanel({ kind: "new" });
        }}
        className="self-start"
      >
        {t("reservations.new.button")}
      </Button>
      <ErrorAlert message={loadError} />
      {sheet}
      {day === null ? (
        !loadError && <Muted>{t("common.loading")}</Muted>
      ) : (
        <DayView
          services={day.services}
          busyId={busy}
          errors={rowErrors}
          onAction={(row, action) => void onAction(row, action)}
        />
      )}
    </>
  );
}

function ReservationsRoute() {
  const data = dateFromQuery(useSearchParams().get("data"));
  return <ReservationsScreen key={data ?? "today"} date={data} />;
}

export default function ReservationsPage() {
  return (
    <Suspense fallback={<Muted>{t("common.loading")}</Muted>}>
      <ReservationsRoute />
    </Suspense>
  );
}
