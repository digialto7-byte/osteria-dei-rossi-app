import { z } from "zod";
import { COURSES, VOID_REASONS } from "@/server/orders/constants";

// Strict output of GET /api/kitchen/tickets (M19 plan §3.2, §3.5). The chef never sees a euro value (founder Q16 = project
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
});

const kitchenTicket = z.strictObject({
  /** `<sessionId>|<firedAt>|<course>|<segue>`: the id of the ticket for the screen. */
  key: z.string(),
  sessionId: z.uuid(),
  tableName: z.string(),
  covers: z.number().int(),
  course: z.enum(COURSES),
  segue: z.boolean(),
  firedAt: z.string(),
  firedBy: z.strictObject({ id: z.uuid(), displayName: z.string() }),
  lines: z.array(kitchenLine),
});

export const kitchenTicketsOutput = z.strictObject({
  asOf: z.string(),
  truncated: z.boolean(),
  tickets: z.array(kitchenTicket),
});

export type KitchenLine = z.infer<typeof kitchenLine>;
export type KitchenTicket = z.infer<typeof kitchenTicket>;
export type KitchenTickets = z.infer<typeof kitchenTicketsOutput>;
