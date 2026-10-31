import { z } from "zod";
import { PAYMENT_TYPES, RECEIPT_TYPES } from "@/server/bill/constants";

// Strict output schemas of the end-of-day endpoints (M21 plan §3.2, §3.5). Owner and admin read these; there is still no cost or margin
// in them. Amounts are numbers for display only: the database computed every figure, including the difference.

const person = z.strictObject({ id: z.uuid(), displayName: z.string() });
const bucket = <T extends readonly [string, ...string[]]>(types: T) =>
  z.strictObject({ type: z.enum(types), total: z.number(), tables: z.number().int() });

export const appVsRegisterOutput = z.strictObject({
  businessDate: z.string(),
  asOf: z.string(),
  app: z.strictObject({
    total: z.number(),
    tables: z.number().int(),
    covers: z.number().int(),
    byReceiptType: z.array(bucket(RECEIPT_TYPES)),
    byPaymentType: z.array(bucket(PAYMENT_TYPES)),
  }),
  register: z
    .strictObject({
      total: z.number(),
      enteredAt: z.string(),
      enteredBy: person,
      entries: z.number().int(),
    })
    .nullable(),
  /** App minus register, and that as a percentage of the register total (null when the register total is 0). */
  difference: z.strictObject({ amount: z.number(), pct: z.number().nullable() }).nullable(),
  missingReceipts: z.array(
    z.strictObject({
      sessionId: z.uuid(),
      tableName: z.string(),
      covers: z.number().int(),
      closedAt: z.string(),
      closedBy: person,
      receiptType: z.enum(RECEIPT_TYPES),
      paymentType: z.enum(PAYMENT_TYPES),
      total: z.number(),
    }),
  ),
  openTables: z.strictObject({ count: z.number().int(), provisionalTotal: z.number() }),
  lateOps: z.strictObject({ count: z.number().int() }),
});

export const enterDayCloseOutput = z.strictObject({
  changed: z.boolean(),
  report: appVsRegisterOutput,
});

export type AppVsRegister = z.infer<typeof appVsRegisterOutput>;
export type EnterDayCloseOutput = z.infer<typeof enterDayCloseOutput>;
