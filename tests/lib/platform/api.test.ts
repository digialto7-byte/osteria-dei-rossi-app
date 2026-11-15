import { describe, expect, it } from "vitest";
import {
  auditQuerySchema,
  auditResponseSchema,
  auditRowSchema,
  PLATFORM_API_SCHEMAS,
  PLATFORM_ROUTE_ERRORS,
  tenantDetailResponseSchema,
  tenantSummarySchema,
  tenantsResponseSchema,
} from "@/lib/platform/api";
import {
  PLATFORM_COMMON_ERROR_CODES,
  PLATFORM_NEW_ERROR_CODES,
  PLATFORM_PLATFORM_ERROR_CODES,
} from "@/lib/platform/codes";

// SP3 step 21a (plan section 3.4, FINAL). Builder 2 mocks against this module: every schema has a documented example (PLATFORM_API_SCHEMAS) that must parse.
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const AT = "2026-11-15T10:00:00Z";

const summary = {
  id: A,
  name: "Osteria Demo A",
  organisation: { id: B, name: "Gruppo Demo", tenantCount: 1 },
  createdAt: AT,
  members: { owner: 1, admin: 0, chef: 1, waiter: 2 },
  digialtoAttached: false,
  lastActivityDate: "2026-11-14",
};
const row = {
  id: 7,
  at: AT,
  tenantId: A,
  tenantName: "Osteria Demo A",
  action: "console.entered",
  origin: "console",
  detail: { mode: "console", changed: true, sessionsRevoked: 2, slot: null },
};

describe("the documented examples", () => {
  const entries = Object.entries(PLATFORM_API_SCHEMAS);

  it("cover every request and reply of section 3.4", () => {
    expect(Object.keys(PLATFORM_API_SCHEMAS).sort()).toEqual(
      [
        "accountMfaGetResponse",
        "accountMfaCodeRequest",
        "accountMfaCodeResponse",
        "accountMfaEnrolRequest",
        "accountMfaEnrolResponse",
        "accountMfaVerifyRequest",
        "accountMfaVerifyResponse",
        "auditQuery",
        "auditResponse",
        "consoleRequest",
        "consoleResponse",
        "errorBody",
        "logoutRequest",
        "logoutResponse",
        "meResponse",
        "noticeNotifiedRequest",
        "noticeNotifiedResponse",
        "noticesResponse",
        "openTenantRequest",
        "openTenantResponse",
        "passwordSignInRequest",
        "passwordSignInResponse",
        "tenantDetailResponse",
        "tenantsResponse",
      ].sort(),
    );
  });

  it.each(entries)("%s: the example parses", (_name, { schema, example }) => {
    expect(schema.safeParse(example).success).toBe(true);
  });

  it.each(entries)("%s: an extra key is refused", (_name, { schema, example }) => {
    expect(schema.safeParse({ ...(example as object), extra: 1 }).success).toBe(false);
  });
});

describe("shapes", () => {
  it("TenantSummary, detail and audit rows keep their documented examples", () => {
    expect(tenantSummarySchema.parse(summary)).toEqual(summary);
    expect(tenantsResponseSchema.parse({ tenants: [summary] }).tenants).toHaveLength(1);
    expect(auditRowSchema.parse(row)).toEqual(row);
  });

  it("nested objects refuse an extra key too", () => {
    expect(
      tenantSummarySchema.safeParse({ ...summary, members: { ...summary.members, guest: 1 } })
        .success,
    ).toBe(false);
    expect(
      tenantSummarySchema.safeParse({
        ...summary,
        organisation: { ...summary.organisation, vat: "x" },
      }).success,
    ).toBe(false);
  });

  it("a detail value may be any finite number, not only an integer", () => {
    expect(auditRowSchema.safeParse({ ...row, detail: { version: 1.5 } }).success).toBe(true);
  });

  it("refuse a detail value that is an object, and an @ in a detail value or a detail KEY", () => {
    expect(auditRowSchema.safeParse({ ...row, detail: { mode: { a: 1 } } }).success).toBe(false);
    expect(auditRowSchema.safeParse({ ...row, detail: { kind: "x@example.test" } }).success).toBe(
      false,
    );
    expect(auditRowSchema.safeParse({ ...row, detail: { "x@example.test": 1 } }).success).toBe(
      false,
    );
  });

  it("uuids are lowercase only", () => {
    expect(tenantSummarySchema.safeParse({ ...summary, id: A.toUpperCase() }).success).toBe(false);
  });

  it("refuse an unknown action, an unknown origin and a count below its minimum", () => {
    expect(auditRowSchema.safeParse({ ...row, action: "console.hacked" }).success).toBe(false);
    expect(auditRowSchema.safeParse({ ...row, origin: "migration" }).success).toBe(false);
    const bad = { ...summary, organisation: { ...summary.organisation, tenantCount: 0 } };
    expect(tenantSummarySchema.safeParse(bad).success).toBe(false);
  });

  it("refuse an activity of 11 rows and rows of 51; accept the limits", () => {
    const tenant = { ...summary, timeZone: "Europe/Rome", bookingSlug: "demo" };
    const rows = (n: number) => Array.from({ length: n }, () => row);
    expect(tenantDetailResponseSchema.safeParse({ tenant, activity: rows(10) }).success).toBe(true);
    expect(tenantDetailResponseSchema.safeParse({ tenant, activity: rows(11) }).success).toBe(
      false,
    );
    expect(auditResponseSchema.safeParse({ rows: rows(50), nextBefore: 3 }).success).toBe(true);
    expect(auditResponseSchema.safeParse({ rows: rows(51), nextBefore: 3 }).success).toBe(false);
  });
});

describe("the audit query, parsed from a real query string (every value is a string)", () => {
  const parse = (qs: string) =>
    auditQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(qs)));
  const base = "dal=2026-10-16&al=2026-11-15";

  it("accepts the required range and the optional filters, and turns prima into a number", () => {
    const parsed = parse(`${base}&locale=${A}&azione=console.left&prima=9`);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.prima).toBe(9);
    expect(parse(base).data?.prima).toBeUndefined();
  });

  it.each(["0", "-5", "1.5", "abc", "+3", "1e3", "", " 4", "007", "9007199254740993"])(
    "refuses prima=%j",
    (value) => {
      expect(parse(`${base}&prima=${encodeURIComponent(value)}`).success).toBe(false);
    },
  );

  it("needs dal and al, al >= dal, at most 366 days, a real calendar day, and no unknown key", () => {
    expect(parse("al=2026-11-15").success).toBe(false);
    expect(parse("dal=2026-10-16").success).toBe(false);
    expect(parse("dal=2026-11-15&al=2026-11-14").success).toBe(false);
    expect(parse("dal=2025-11-15&al=2026-11-16").success).toBe(true);
    expect(parse("dal=2025-11-14&al=2026-11-16").success).toBe(false);
    expect(parse("dal=2026-02-30&al=2026-03-01").success).toBe(false);
    expect(parse(`${base}&azione=nope`).success).toBe(false);
    expect(parse(`${base}&locale=x`).success).toBe(false);
    expect(parse(`${base}&limit=5`).success).toBe(false);
  });
});

describe("error codes of section 3.4", () => {
  it("the eight new codes join ErrorCode", () => {
    expect([...PLATFORM_NEW_ERROR_CODES].sort()).toEqual(
      [
        "console_selection_required",
        "console_session",
        "console_switch_failed",
        "not_console_account",
        "mfa_factor_required",
        "tenant_not_found",
        "notice_not_found",
        "digialto_not_attached",
      ].sort(),
    );
  });

  it("the common lists are the ones of 3.4.1", () => {
    expect([...PLATFORM_COMMON_ERROR_CODES]).toEqual([
      "unauthenticated",
      "session_expired",
      "internal",
    ]);
    expect([...PLATFORM_PLATFORM_ERROR_CODES]).toEqual([
      "console_selection_required",
      "mfa_required",
      "mfa_factor_required",
      "forbidden",
    ]);
  });

  it("each route lists the codes of its table", () => {
    expect(PLATFORM_ROUTE_ERRORS["POST /api/auth/mfa/account"]).toEqual([
      "forbidden",
      "not_found",
      "mfa_code_invalid",
      "mfa_challenge_expired",
      "mfa_locked",
      "rate_limited",
      "upstream_error",
    ]);
    expect(PLATFORM_ROUTE_ERRORS["POST /api/platform/auth/password"]).toEqual([
      "invalid_request",
      "login_invalid",
      "not_console_account",
      "rate_limited",
      "upstream_error",
    ]);
    expect(PLATFORM_ROUTE_ERRORS["POST /api/platform/console"]).toContain("console_switch_failed");
    expect(PLATFORM_ROUTE_ERRORS["POST /api/platform/tenants/[id]/open"]).toEqual([
      "not_found",
      "tenant_not_found",
      "digialto_not_attached",
    ]);
    expect(PLATFORM_ROUTE_ERRORS["GET /api/platform/audit"]).toEqual(["invalid_request"]);
    expect(PLATFORM_ROUTE_ERRORS["POST /api/platform/logout"]).toEqual([]);
    expect(Object.keys(PLATFORM_ROUTE_ERRORS)).toHaveLength(14);
  });
});
