import { z } from "zod";
import {
  COURSES,
  HELD_FROM,
  USCITA_MAX,
  USCITA_MIN,
  VOID_REASONS,
} from "@/server/orders/constants";
import { FIRED_AT_RE } from "./constants";

// Strict output of GET /api/kitchen/tickets and of the two kitchen write routes (M19 plan §3.2, §3.5; M19b plan §3.2, §3.5). The chef never sees a euro value (founder Q16 = project
// V6): there is no price, cost, VAT or total anywhere, and a key that is not declared makes the parse throw (a 500, never
// a leak). Every key passes pgTAP 059's chef regex. The shapes are snapshot-tested.
// Comanda per uscita (plan 2026-11-18 §3.9, pgTAP 426): a ticket is (session, instant, uscita), with no course and no segue; each line
// carries its course; held lines (uscita >= 2, not called) are not tickets but wait folded per (session, uscita), with no mark target.

const kitchenLine = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  course: z.enum(COURSES),
  qty: z.number(),
  /** Grams of a weighted line ("Fiorentina 1,2 kg"), null on a portion line (P2-0b). A quantity, never a price. */
  weightG: z.number().int().nullable(),
  note: z.string().nullable(),
  isShared: z.boolean(),
  voided: z.boolean(),
  voidReason: z.enum(VOID_REASONS).nullable(),
  /** Not voided and its latest kitchen event is "done". Decided in SQL. */
  done: z.boolean(),
});

/** A held dish: shown folded under its waiting uscita. Never a mark target, so no done and no void state (a voided held line leaves the list). */
const waitingLine = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  course: z.enum(COURSES),
  qty: z.number(),
  weightG: z.number().int().nullable(),
  note: z.string().nullable(),
  isShared: z.boolean(),
});

const waitingUscita = z.strictObject({
  sessionId: z.uuid(),
  tableName: z.string(),
  uscita: z.number().int().min(HELD_FROM).max(USCITA_MAX),
  lineCount: z.number().int().min(1),
  lines: z.array(waitingLine),
});

const uscita = z.number().int().min(USCITA_MIN).max(USCITA_MAX);
/** The six-decimal UTC text of app.kitchen_ticket_rows; the ticket's firedAt is sent back as is in the close body. */
const instant = z.string().regex(FIRED_AT_RE);

const staffRef = z.strictObject({ id: z.uuid(), displayName: z.string() });

const kitchenTicket = z.strictObject({
  /** `<sessionId>|<firedAt>|u<uscita>`: the id of the ticket for the screen. */
  key: z.string(),
  sessionId: z.uuid(),
  tableName: z.string(),
  covers: z.number().int(),
  /** 0 = Subito (drinks), 1..9 = the uscita. */
  uscita,
  /** A later ticket of the same (session, uscita): dishes sent after its first ticket ("aggiunta"). Decided in SQL. */
  addition: z.boolean(),
  /** The ticket instant: fired_at for uscite 0-1, greatest(fired_at, called_at) for a called uscita >= 2. */
  firedAt: instant,
  /** When the uscita was called ("Via la 2ª"); null for uscite 0-1. */
  calledAt: instant.nullable(),
  firedBy: staffRef,
  /** Non-voided lines, and how many of them are done: "2 di 5 fatti". Counted in SQL. */
  lineCount: z.number().int().min(0),
  doneCount: z.number().int().min(0),
  /** Set when the comanda is closed (by hand or by itself). */
  closedAt: z.string().nullable(),
  closedBy: staffRef.nullable(),
  autoClosed: z.boolean(),
  lines: z.array(kitchenLine),
});

export const kitchenTicketsOutput = z.strictObject({
  asOf: z.string(),
  truncated: z.boolean(),
  /** The dishes still to make on the active comande, counted in SQL ("Da fare: 7"). */
  remaining: z.number().int().min(0),
  /** Held dishes, not yet in the kitchen's queue; and how many. */
  waitingCount: z.number().int().min(0),
  waiting: z.array(waitingUscita),
  tickets: z.array(kitchenTicket),
  closedTickets: z.array(kitchenTicket),
});

/** Reply of POST /api/kitchen/lines/:id/mark. The board is read after the write, so the tapping device updates at once. */
export const markLineOutput = z.strictObject({
  changed: z.boolean(),
  autoClosed: z.boolean(),
  reopened: z.boolean(),
  board: kitchenTicketsOutput,
});

/** Reply of POST /api/kitchen/tickets/mark. */
export const markTicketOutput = z.strictObject({
  changed: z.boolean(),
  board: kitchenTicketsOutput,
});

export type KitchenLine = z.infer<typeof kitchenLine>;
export type KitchenWaiting = z.infer<typeof waitingUscita>;
export type KitchenTicket = z.infer<typeof kitchenTicket>;
export type KitchenTickets = z.infer<typeof kitchenTicketsOutput>;
export type MarkLineReply = z.infer<typeof markLineOutput>;
export type MarkTicketReply = z.infer<typeof markTicketOutput>;
