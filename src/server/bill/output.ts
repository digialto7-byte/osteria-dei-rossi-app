import { z } from "zod";
import { COURSES } from "@/server/orders/constants";
import { PAYMENT_TYPES, RECEIPT_TYPES } from "./constants";

// Strict output schemas of the bill endpoints (M21 plan §3.2, §3.5). The services parse every database reply here, so a key that is not
// declared (a cost that slipped into an RPC reply) makes the parse throw: a 500, never a leak. A waiter reads these, so there is no
// cost, margin, GP, food cost, recipe key or VAT rate anywhere. Amounts are numbers with at most two decimals, for display only: the
// database computed them and nothing in the browser adds, splits or rounds money. The shapes are snapshot-tested.

/** A line on the bill. Voided lines are never billed, so the state is draft or fired. */
export const billLine = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  course: z.enum(COURSES),
  qty: z.number(),
  unitPrice: z.number(),
  amount: z.number(),
  state: z.enum(["draft", "fired"]),
  isShared: z.boolean(),
});

const person = z.strictObject({ id: z.uuid(), displayName: z.string() });

export const billReceipt = z.strictObject({
  type: z.enum(RECEIPT_TYPES),
  number: z.string().nullable(),
  paymentType: z.enum(PAYMENT_TYPES),
  missingReceipt: z.boolean(),
  closedAt: z.string(),
  closedBy: person,
  businessDate: z.string(),
});

const billSplit = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("covers"),
    parts: z.array(z.strictObject({ index: z.number().int(), amount: z.number() })),
  }),
  z.strictObject({
    mode: z.literal("items"),
    parts: z.array(
      z.strictObject({
        index: z.number().int(),
        covers: z.number().int(),
        lineIds: z.array(z.uuid()),
        sharedAmount: z.number(),
        amount: z.number(),
      }),
    ),
  }),
]);

export const billOutput = z.strictObject({
  sessionId: z.uuid(),
  tableName: z.string(),
  covers: z.number().int(),
  closed: z.boolean(),
  billToken: z.string(),
  lines: z.array(billLine),
  coperto: z
    .strictObject({ perPerson: z.number(), covers: z.number().int(), amount: z.number() })
    .nullable(),
  subtotal: z.number(),
  total: z.number(),
  unsentLineIds: z.array(z.uuid()),
  split: billSplit.nullable(),
  receipt: billReceipt.nullable(),
});

export const closeOutput = z.strictObject({ changed: z.boolean(), bill: billOutput });

/** The DETAIL of an `unsent_lines` (ids only, at most 50). */
export const unsentLinesDetails = z.strictObject({ lineIds: z.array(z.uuid()).max(50) });

export const SPLIT_REASONS = [
  "line_missing",
  "line_twice",
  "line_unknown",
  "covers_mismatch",
] as const;
/** The DETAIL of a `split_invalid` (a code only). */
export const splitInvalidDetails = z.strictObject({ reason: z.enum(SPLIT_REASONS) });

export type BillLine = z.infer<typeof billLine>;
export type BillReceipt = z.infer<typeof billReceipt>;
export type BillOutput = z.infer<typeof billOutput>;
export type CloseOutput = z.infer<typeof closeOutput>;
export type UnsentLinesDetails = z.infer<typeof unsentLinesDetails>;
export type SplitInvalidDetails = z.infer<typeof splitInvalidDetails>;
