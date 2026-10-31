import { z } from "zod";
import { idParams } from "@/server/orders/schemas";
import {
  MAX_SPLIT_GROUPS,
  MAX_SPLIT_IDS,
  MAX_SPLIT_PARTS,
  MIN_SPLIT_PARTS,
  PAYMENT_TYPES,
  RECEIPT_NUMBER,
  RECEIPT_TYPES,
} from "./constants";

// Strict inputs of the bill endpoints (M21 plan §3.5). The bounds mirror the SQL, which stays the authority: the schemas only turn the
// obvious mistakes into a 400 before any RPC. No money comes in: the bill is computed by the database from the lines.

export { idParams };

/** `?parts=n` asks for the split by covers. */
export const billQuery = z.strictObject({
  parts: z.coerce.number().int().min(MIN_SPLIT_PARTS).max(MAX_SPLIT_PARTS).optional(),
});

const lineIds = z.array(z.uuid()).max(MAX_SPLIT_IDS);

export const splitBody = z
  .strictObject({
    groups: z
      .array(z.strictObject({ lineIds, covers: z.number().int().min(0).max(99) }))
      .min(2)
      .max(MAX_SPLIT_GROUPS),
    sharedLineIds: lineIds,
  })
  .superRefine((body, ctx) => {
    const all = [...body.groups.flatMap((g) => g.lineIds), ...body.sharedLineIds];
    if (all.length > MAX_SPLIT_IDS) ctx.addIssue({ code: "custom", message: "too many lines" });
    if (new Set(all).size !== all.length)
      ctx.addIssue({ code: "custom", message: "a line appears twice" });
  });

/** Trimmed; blank or null means "no number" (the table is closed and flagged, never refused). */
const receiptNumber = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value === "" ? null : value))
  .pipe(z.string().regex(RECEIPT_NUMBER).nullable())
  .nullable();

export const closeBody = z.strictObject({
  receiptType: z.enum(RECEIPT_TYPES),
  receiptNumber,
  paymentType: z.enum(PAYMENT_TYPES),
  /** The token of the bill the waiter saw: 32 lowercase hex digits. */
  billToken: z.string().regex(/^[0-9a-f]{32}$/),
});

export type BillQuery = z.infer<typeof billQuery>;
export type SplitBody = z.infer<typeof splitBody>;
export type CloseBody = z.infer<typeof closeBody>;
