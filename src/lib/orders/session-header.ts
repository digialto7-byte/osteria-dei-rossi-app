import { sessionCoperto, type SessionCoperto } from "@/server/tables/output";

/** The coperto is not known (the key is missing or invalid). Distinct from `null`, which is the server's "no coperto". */
export const UNKNOWN = "unknown" as const;

/**
 * What the comanda's header can show about its session. Every field is read strictly; nothing is made up.
 * - `openedBy`, `openedAt`, `openedToday`: null when missing or invalid. An empty `displayName` is invalid on purpose, although the
 *   server schema is `z.string()`: an empty name is not a usable opener (Rule B), so it reads as unknown.
 * - `coperto`: a `SessionCoperto` (present), `null` (the server said: no coperto) or `UNKNOWN` (missing or invalid). The three never mix.
 * - `queuedAt`: the tap time of a table opened offline (the queued variant of overlayOrder); null for a server session.
 */
export interface SessionHeader {
  openedBy: string | null;
  openedAt: string | null;
  openedToday: boolean | null;
  coperto: SessionCoperto | null | typeof UNKNOWN;
  queuedAt: string | null;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const instantOf = (value: unknown): string | null =>
  typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null;

function openerOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const name = (value as Record<string, unknown>).displayName;
  return typeof name === "string" && name !== "" ? name : null;
}

/**
 * The header fields of the comanda's session (DS-BQ-2), read from a value the type cannot be trusted for. The service worker's
 * `api-user` cache has no build version, so an offline phone can serve a reply cached before DS-BQ-2, without openedAt, openedToday,
 * openedBy and coperto, while `OrderView` says they are there. Same idea as `unsentCountOf` (BQ-1, Q-B3): missing or invalid is unknown,
 * never a fake value. The queued variant (`source: "queued"`) knows the opener and the tap time only; the rest stays unknown.
 *
 * Not wired into any screen yet: the UX builder wires it into the header of the direct comanda. Pure.
 */
export function sessionHeaderOf(session: unknown): SessionHeader {
  const unknown: SessionHeader = {
    openedBy: null,
    openedAt: null,
    openedToday: null,
    coperto: UNKNOWN,
    queuedAt: null,
  };
  if (typeof session !== "object" || session === null || Array.isArray(session)) return unknown;
  const fields = session as Record<string, unknown>;
  const openedBy = openerOf(fields.openedBy);
  if (fields.source === "queued") {
    return { ...unknown, openedBy, queuedAt: instantOf(fields.queuedAt) };
  }
  let coperto: SessionHeader["coperto"] = UNKNOWN;
  if (fields.coperto === null) coperto = null;
  else {
    const parsed = sessionCoperto.safeParse(fields.coperto);
    if (parsed.success) coperto = parsed.data;
  }
  return {
    openedBy,
    openedAt: instantOf(fields.openedAt),
    openedToday: typeof fields.openedToday === "boolean" ? fields.openedToday : null,
    coperto,
    queuedAt: null,
  };
}
