import { z } from "zod";
import { COURSES } from "@/server/orders/constants";
import { FIRED_AT_RE } from "./constants";

// Bodies of the two kitchen write routes (M19b plan §3.5). Strict: an unknown key is a 400. Taps carry the state they want, never a
// toggle, so a double tap or a retried request writes once.

export const markLineBody = z.strictObject({ done: z.boolean() });

export const markTicketBody = z.strictObject({
  sessionId: z.uuid(),
  firedAt: z.string().regex(FIRED_AT_RE),
  course: z.enum(COURSES),
  segue: z.boolean(),
  closed: z.boolean(),
});

export type MarkLineBody = z.infer<typeof markLineBody>;
export type MarkTicketBody = z.infer<typeof markTicketBody>;
