import { z } from "zod";
import { USCITA_MAX, USCITA_MIN } from "@/server/orders/constants";
import { FIRED_AT_RE } from "./constants";

// Bodies of the two kitchen write routes (M19b plan §3.5). Strict: an unknown key is a 400. Taps carry the state they want, never a
// toggle, so a double tap or a retried request writes once. Comanda per uscita (plan 2026-11-18 §3.9): a ticket is keyed
// {sessionId, firedAt, uscita}; the legacy {course, segue} body is refused here (400) and by kitchen_set_ticket (22023).

export const markLineBody = z.strictObject({ done: z.boolean() });

export const markTicketBody = z.strictObject({
  sessionId: z.uuid(),
  firedAt: z.string().regex(FIRED_AT_RE),
  uscita: z.number().int().min(USCITA_MIN).max(USCITA_MAX),
  closed: z.boolean(),
});

export type MarkLineBody = z.infer<typeof markLineBody>;
export type MarkTicketBody = z.infer<typeof markTicketBody>;
