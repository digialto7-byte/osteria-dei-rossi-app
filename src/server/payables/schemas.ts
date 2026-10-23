import { z } from "zod";
import { PAYABLE_REASON_MAX } from "./constants";
import { PAYABLE_STATUSES } from "./types";

export const idParams = z.object({ id: z.uuid() });

// Shapes only; the transition rules are the database's (409 and 422 from set_payable_status).
// The one cross-field rule here is the reversal's: it names status open and a reason (plan §3.3).
export const patchPayableBody = z
  .strictObject({
    status: z.enum(PAYABLE_STATUSES),
    paidOn: z.iso.date().optional(),
    reason: z.string().trim().min(1).max(PAYABLE_REASON_MAX).optional(),
    reversal: z.literal(true).optional(),
  })
  .refine((body) => !body.reversal || (body.status === "open" && body.reason !== undefined), {
    message: "reversal needs status open and a reason",
    path: ["reversal"],
  });

export type PatchPayableBody = z.infer<typeof patchPayableBody>;
