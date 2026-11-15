import { z } from "zod";
import { PLATFORM_AUDIT_ACTIONS, PLATFORM_AUDIT_ORIGINS, PLATFORM_NOTICE_KINDS } from "./codes";

// SP3 step 21a (plan section 3.4, FINAL): the shapes of the console API, shared by the screens and by src/server/platform/output.ts.
// Client-importable: this module imports only zod and ./codes. Every object is strict: an unknown key is a refusal, never ignored.

const uuid = z
  .uuid()
  .refine((value) => value === value.toLowerCase(), { message: "uuid must be lowercase" });
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
const noAt = (value: string) => !value.includes("@");
const detailValue = z.union([
  z.string().refine(noAt, { message: "no @ in detail" }),
  z.number(),
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
  detail: z.record(z.string().refine(noAt, { message: "no @ in a detail key" }), detailValue),
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

/** A positive integer from a query string: digits only, no sign, no exponent, no leading zero, within the safe range. */
const queryPositiveInt = z
  .string()
  .regex(/^[1-9][0-9]*$/, "a positive integer")
  .transform(Number)
  .pipe(z.number().int().safe());

const DAY_MS = 86_400_000;
/** GET /api/platform/audit query: dal and al required, al >= dal and at most 366 days after; the page size is not a parameter. */
export const auditQuerySchema = z
  .strictObject({
    dal: day,
    al: day,
    locale: uuid.optional(),
    azione: z.enum(PLATFORM_AUDIT_ACTIONS).optional(),
    prima: queryPositiveInt.optional(),
  })
  .refine(
    ({ dal, al }) => {
      const span = (Date.parse(`${al}T00:00:00Z`) - Date.parse(`${dal}T00:00:00Z`)) / DAY_MS;
      return span >= 0 && span <= 366;
    },
    { message: "al must be on or after dal, at most 366 days later", path: ["al"] },
  );
export type AuditQuery = z.infer<typeof auditQuerySchema>;

// ---- The rest of section 3.4: every request and reply, each with a documented example (builder 2 mocks against these) ----

const emptyBody = z.strictObject({});
const slotInput = z.enum(["principale", "riserva"]);
const sixDigits = z.string().regex(/^\d{6}$/);

export const errorBodySchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const meResponseSchema = z.strictObject({ displayName: z.string(), unreadNotices: count });
export const openTenantResponseSchema = z.strictObject({ url: z.url() });
export const noticeNotifiedRequestSchema = z.strictObject({ tenantId: uuid });
export const noticeNotifiedResponseSchema = z.strictObject({
  notifiedAt: instant,
  changed: z.boolean(),
});

export const PLATFORM_SIGN_IN_REDIRECTS = ["/login/codice", "/login/attiva-codice"] as const;
export const passwordSignInRequestSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});
export const passwordSignInResponseSchema = z.strictObject({
  redirect: z.enum(PLATFORM_SIGN_IN_REDIRECTS),
});
export const consoleResponseSchema = z.strictObject({ mode: z.literal("console") });
export const logoutResponseSchema = z.strictObject({ ok: z.literal(true) });

export const accountMfaGetResponseSchema = z.strictObject({
  factors: z.array(mfaFactorSchema),
  currentLevel: z.enum(["aal1", "aal2"]),
  canAddFactor: z.boolean(),
  lockedUntil: instant.nullable(),
});
export const accountMfaCodeRequestSchema = z.strictObject({
  factorId: uuid,
  code: sixDigits,
  next: z.string().max(512).optional(),
});
export const accountMfaCodeResponseSchema = z.strictObject({ redirect: z.string() });
export const accountMfaEnrolRequestSchema = z.strictObject({ slot: slotInput });
export const accountMfaEnrolResponseSchema = z.strictObject({
  factorId: uuid,
  slot: slotInput,
  qrImage: z.string().startsWith("data:image/svg+xml"),
  secret: z.string().min(1),
});
export const accountMfaVerifyRequestSchema = z.strictObject({ code: sixDigits });
export const accountMfaVerifyResponseSchema = z.strictObject({
  factor: z.strictObject({
    id: uuid,
    slot: z.enum(["principale", "riserva", "altro"]),
    status: z.literal("verified"),
    createdAt: instant,
  }),
  currentLevel: z.literal("aal2"),
});

const exampleTenantDetail = {
  id: "a0000000-0000-4000-8000-00000000000a",
  name: "Osteria Demo A",
  organisation: { id: "b0000000-0000-4000-8000-00000000000b", name: "Gruppo Demo", tenantCount: 1 },
  createdAt: "2026-11-15T10:00:00Z",
  members: { owner: 1, admin: 0, chef: 1, waiter: 2 },
  digialtoAttached: false,
  lastActivityDate: "2026-11-14",
  timeZone: "Europe/Rome",
  bookingSlug: null,
};
const exampleRow = {
  id: 7,
  at: "2026-11-15T10:00:00Z",
  tenantId: exampleTenantDetail.id,
  tenantName: "Osteria Demo A",
  action: "console.entered",
  origin: "console",
  detail: { mode: "console", changed: true },
};
const exampleFactorId = "f0000000-0000-4000-8000-00000000000f";

/** Every schema of section 3.4 with a documented example. A test parses each example and refuses an extra key on each. */
export const PLATFORM_API_SCHEMAS = {
  errorBody: {
    schema: errorBodySchema,
    example: { error: { code: "forbidden", message: "Non consentito." } },
  },
  passwordSignInRequest: {
    schema: passwordSignInRequestSchema,
    example: { email: "staff@example.test", password: "test-password" },
  },
  passwordSignInResponse: {
    schema: passwordSignInResponseSchema,
    example: { redirect: "/login/attiva-codice" },
  },
  consoleRequest: { schema: emptyBody, example: {} },
  consoleResponse: { schema: consoleResponseSchema, example: { mode: "console" } },
  logoutRequest: { schema: emptyBody, example: {} },
  logoutResponse: { schema: logoutResponseSchema, example: { ok: true } },
  meResponse: { schema: meResponseSchema, example: { displayName: "DigiAlto", unreadNotices: 1 } },
  tenantsResponse: {
    schema: tenantsResponseSchema,
    example: {
      tenants: [exampleTenantDetail].map(({ timeZone: _t, bookingSlug: _b, ...rest }) => rest),
    },
  },
  tenantDetailResponse: {
    schema: tenantDetailResponseSchema,
    example: { tenant: exampleTenantDetail, activity: [exampleRow] },
  },
  openTenantRequest: { schema: emptyBody, example: {} },
  openTenantResponse: {
    schema: openTenantResponseSchema,
    example: {
      url: `https://app.example.test/login/scegli-locale?locale=${exampleTenantDetail.id}`,
    },
  },
  auditQuery: { schema: auditQuerySchema, example: { dal: "2026-10-16", al: "2026-11-15" } },
  auditResponse: { schema: auditResponseSchema, example: { rows: [exampleRow], nextBefore: 7 } },
  noticesResponse: {
    schema: noticesResponseSchema,
    example: {
      notices: [
        {
          id: exampleFactorId,
          kind: "subprocessor",
          version: 1,
          createdAt: "2026-11-15T10:00:00Z",
          pending: [{ id: exampleTenantDetail.id, name: "Osteria Demo A" }],
          notified: [],
        },
      ],
    },
  },
  noticeNotifiedRequest: {
    schema: noticeNotifiedRequestSchema,
    example: { tenantId: exampleTenantDetail.id },
  },
  noticeNotifiedResponse: {
    schema: noticeNotifiedResponseSchema,
    example: { notifiedAt: "2026-11-15T10:00:00Z", changed: true },
  },
  accountMfaGetResponse: {
    schema: accountMfaGetResponseSchema,
    example: {
      factors: [{ id: exampleFactorId, slot: "principale", status: "verified" }],
      currentLevel: "aal1",
      canAddFactor: true,
      lockedUntil: null,
    },
  },
  accountMfaCodeRequest: {
    schema: accountMfaCodeRequestSchema,
    example: { factorId: exampleFactorId, code: "123456", next: "/" },
  },
  accountMfaCodeResponse: { schema: accountMfaCodeResponseSchema, example: { redirect: "/" } },
  accountMfaEnrolRequest: { schema: accountMfaEnrolRequestSchema, example: { slot: "principale" } },
  accountMfaEnrolResponse: {
    schema: accountMfaEnrolResponseSchema,
    example: {
      factorId: exampleFactorId,
      slot: "principale",
      qrImage: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
      secret: "TESTSECRETTESTSECRET",
    },
  },
  accountMfaVerifyRequest: { schema: accountMfaVerifyRequestSchema, example: { code: "123456" } },
  accountMfaVerifyResponse: {
    schema: accountMfaVerifyResponseSchema,
    example: {
      factor: {
        id: exampleFactorId,
        slot: "principale",
        status: "verified",
        createdAt: "2026-11-15T10:00:00Z",
      },
      currentLevel: "aal2",
    },
  },
} as const;

/** The error codes each route lists in section 3.4 (besides the common ones of 3.4.1: every non-public route, and the platform ones on /api/platform reads). */
export const PLATFORM_ROUTE_ERRORS = {
  "GET /api/auth/mfa/account": ["forbidden"],
  "POST /api/auth/mfa/account": [
    "forbidden",
    "not_found",
    "mfa_code_invalid",
    "mfa_challenge_expired",
    "mfa_locked",
    "rate_limited",
    "upstream_error",
  ],
  "POST /api/auth/mfa/account/factors": [
    "forbidden",
    "mfa_required",
    "mfa_slot_taken",
    "mfa_factor_limit",
    "rate_limited",
    "upstream_error",
  ],
  "POST /api/auth/mfa/account/factors/[id]/verify": [
    "forbidden",
    "not_found",
    "mfa_code_invalid",
    "mfa_challenge_expired",
    "mfa_locked",
    "rate_limited",
    "upstream_error",
  ],
  "POST /api/platform/auth/password": [
    "invalid_request",
    "login_invalid",
    "not_console_account",
    "rate_limited",
    "upstream_error",
  ],
  "POST /api/platform/console": [
    "unauthenticated",
    "session_missing",
    "forbidden",
    "mfa_factor_required",
    "mfa_required",
    "console_switch_failed",
  ],
  "POST /api/platform/logout": [],
  "GET /api/platform/me": [],
  "GET /api/platform/tenants": [],
  "GET /api/platform/tenants/[id]": ["not_found", "tenant_not_found"],
  "POST /api/platform/tenants/[id]/open": [
    "not_found",
    "tenant_not_found",
    "digialto_not_attached",
  ],
  "GET /api/platform/audit": ["invalid_request"],
  "GET /api/platform/notices": [],
  "POST /api/platform/notices/[id]/notified": ["not_found", "notice_not_found", "tenant_not_found"],
} as const;
