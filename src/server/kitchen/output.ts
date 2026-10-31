import { z } from "zod";
import { COURSES, VOID_REASONS } from "@/server/orders/constants";

// Strict output of GET /api/kitchen/tickets and of the two kitchen write routes (M19 plan §3.2, §3.5; M19b plan §3.2, §3.5). The chef never sees a euro value (founder Q16 = project
// V6): there is no price, cost, VAT or total anywhere, and a key that is not declared makes the parse throw (a 500, never
// a leak). Every key passes pgTAP 059's chef regex. The shapes are snapshot-tested.

const kitchenLine = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  qty: z.number(),
  note: z.string().nullable(),
  isShared: z.boolean(),
  voided: z.boolean(),
  voidReason: z.enum(VOID_REASONS).nullable(),
  /** Not voided and its latest kitchen event is "done". Decided in SQL. */
  done: z.boolean(),
});

const staffRef = z.strictObject({ id: z.uuid(), displayName: z.string() });

const kitchenTicket = z.strictObject({
  /** `<sessionId>|<firedAt>|<course>|<segue>`: the id of the ticket for the screen. */
  key: z.string(),
  sessionId: z.uuid(),
  tableName: z.string(),
  covers: z.number().int(),
  course: z.enum(COURSES),
  segue: z.boolean(),
  firedAt: z.string(),
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
export type KitchenTicket = z.infer<typeof kitchenTicket>;
export type KitchenTickets = z.infer<typeof kitchenTicketsOutput>;
export type MarkLineReply = z.infer<typeof markLineOutput>;
export type MarkTicketReply = z.infer<typeof markTicketOutput>;
