import { z } from "zod";
import { CONTROL_OR_BIDI } from "@/server/invoices/file-check";

/** `POST …/approve`: the storage location is needed only when the venue has more than one. */
export const approveBody = z.strictObject({ locationId: z.uuid().optional() });
export type ApproveBody = z.infer<typeof approveBody>;

/** The longest reason `reject_invoice` accepts (audit_event.reason). */
export const MAX_REASON_CHARS = 200;

const hasControlOrBidi = (value: string) => new RegExp(CONTROL_OR_BIDI.source, "u").test(value);

/**
 * `POST …/reject`: an optional free-text reason, trimmed, 1 to 200 characters, one line, no control
 * or bidirectional characters. Omit it for no reason; a blank string is refused, not stored.
 */
export const rejectBody = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(MAX_REASON_CHARS)
    .refine((value) => !hasControlOrBidi(value), "control or bidirectional characters")
    .optional(),
});
export type RejectBody = z.infer<typeof rejectBody>;
