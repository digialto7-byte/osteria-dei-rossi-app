import { z } from "zod";
import { PLATFORM_AUDIT_ACTIONS, PLATFORM_AUDIT_ORIGINS, PLATFORM_NOTICE_KINDS } from "./codes";

// SP3 step 21a (plan section 3.4, FINAL): the shapes of the console API, shared by the screens and by src/server/platform/output.ts.
// Client-importable: this module imports only zod and ./codes. Every object is strict: an unknown key is a refusal, never ignored.

const uuid = z.uuid();
const instant = z.iso.datetime();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
    {
      message: "not a calendar day",
    },
  );
const count = z.number().int().min(0);

export const tenantSummarySchema = z.strictObject({
  id: uuid,
  name: z.string(),
  organisation: z.strictObject({
    id: uuid,
    name: z.string(),
    tenantCount: z.number().int().min(1),
  }),
  createdAt: instant,
  members: z.strictObject({ owner: count, admin: count, chef: count, waiter: count }),
  digialtoAttached: z.boolean(),
  lastActivityDate: day.nullable(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const tenantDetailSchema = tenantSummarySchema.extend({
  timeZone: z.string().min(1),
  bookingSlug: z.string().nullable(),
});
export type TenantDetail = z.infer<typeof tenantDetailSchema>;

/** Flat, codes and ids only: a value never holds an "@" (the database refuses it too). */
const detailValue = z.union([
  z.string().refine((value) => !value.includes("@"), { message: "no @ in detail" }),
  z.number().int(),
  z.boolean(),
  z.null(),
]);

export const auditRowSchema = z.strictObject({
  id: z.number().int(),
  at: instant,
  tenantId: uuid.nullable(),
  tenantName: z.string().nullable(),
  action: z.enum(PLATFORM_AUDIT_ACTIONS),
  origin: z.enum(PLATFORM_AUDIT_ORIGINS),
  detail: z.record(z.string(), detailValue),
});
export type AuditRow = z.infer<typeof auditRowSchema>;

export const noticeSchema = z.strictObject({
  id: uuid,
  kind: z.enum(PLATFORM_NOTICE_KINDS),
  version: z.number().int().min(1),
  createdAt: instant,
  pending: z.array(z.strictObject({ id: uuid, name: z.string() })),
  notified: z.array(z.strictObject({ id: uuid, name: z.string(), notifiedAt: instant })),
});
export type Notice = z.infer<typeof noticeSchema>;

export const mfaFactorSchema = z.strictObject({
  id: uuid,
  slot: z.enum(["principale", "riserva", "altro"]),
  status: z.enum(["verified", "unverified"]),
});
export type MfaFactor = z.infer<typeof mfaFactorSchema>;

export const tenantsResponseSchema = z.strictObject({ tenants: z.array(tenantSummarySchema) });
export const tenantDetailResponseSchema = z.strictObject({
  tenant: tenantDetailSchema,
  activity: z.array(auditRowSchema).max(10),
});
export const auditResponseSchema = z.strictObject({
  rows: z.array(auditRowSchema).max(50),
  nextBefore: z.number().int().nullable(),
});
export const noticesResponseSchema = z.strictObject({ notices: z.array(noticeSchema) });

const DAY_MS = 86_400_000;
/** GET /api/platform/audit query: dal and al required, al >= dal and at most 366 days after; the page size is not a parameter. */
export const auditQuerySchema = z
  .strictObject({
    dal: day,
    al: day,
    locale: uuid.optional(),
    azione: z.enum(PLATFORM_AUDIT_ACTIONS).optional(),
    prima: z.number().int().optional(),
  })
  .refine(
    ({ dal, al }) => {
      const span = (Date.parse(`${al}T00:00:00Z`) - Date.parse(`${dal}T00:00:00Z`)) / DAY_MS;
      return span >= 0 && span <= 366;
    },
    { message: "al must be on or after dal, at most 366 days later", path: ["al"] },
  );
export type AuditQuery = z.infer<typeof auditQuerySchema>;
