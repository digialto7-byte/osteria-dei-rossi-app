import { describe, expect, expectTypeOf, it } from "vitest";
import {
  accountMfaEnrolResponseSchema,
  accountMfaGetResponseSchema,
  auditRowSchema,
  meResponseSchema,
  noticeSchema,
  tenantDetailResponseSchema,
  tenantDetailSchema,
  tenantSummarySchema,
  tenantsResponseSchema,
  type AuditRow,
  type MfaFactor,
  type Notice,
  type TenantSummary,
} from "@/lib/platform/api";
import type { AccountFactor, AccountMfaStatus } from "@/lib/console/account-mfa";
import type { SortableTenant } from "@/lib/console/locali-view";
import {
  accountStatus,
  auditRow,
  enrolReply,
  meReply,
  notice,
  tenantDetail,
  tenantSummary,
} from "../../components/console/console-fixtures";

// SP3 step 18, step 13: the test fixtures are the final shapes of @/lib/platform/api, and the helpers' types are those shapes.
describe("the console fixtures", () => {
  it("every fixture parses with the final schema of its route", () => {
    expect(tenantSummarySchema.safeParse(tenantSummary()).success).toBe(true);
    expect(tenantDetailSchema.safeParse(tenantDetail()).success).toBe(true);
    expect(auditRowSchema.safeParse(auditRow()).success).toBe(true);
    expect(noticeSchema.safeParse(notice()).success).toBe(true);
    expect(meResponseSchema.safeParse(meReply()).success).toBe(true);
    expect(accountMfaGetResponseSchema.safeParse(accountStatus()).success).toBe(true);
    expect(accountMfaEnrolResponseSchema.safeParse(enrolReply()).success).toBe(true);
  });

  it("the response wrappers accept lists built from them", () => {
    expect(
      tenantsResponseSchema.safeParse({
        tenants: [tenantSummary(), tenantSummary({ id: "c0000000-0000-4000-8000-00000000000c" })],
      }).success,
    ).toBe(true);
    expect(
      tenantDetailResponseSchema.safeParse({ tenant: tenantDetail(), activity: [auditRow()] })
        .success,
    ).toBe(true);
  });

  it("an override is applied and the result is still valid", () => {
    const row = auditRow({
      action: "script.mfa_reset",
      origin: "script",
      tenantId: null,
      tenantName: null,
    });
    expect(row.action).toBe("script.mfa_reset");
    expect(auditRowSchema.safeParse(row).success).toBe(true);
  });

  it("each call returns a fresh object, so a test cannot change another's data", () => {
    const a = tenantSummary();
    a.members.owner = 99;
    expect(tenantSummary().members.owner).not.toBe(99);
  });

  it("uses fake names only and no e-mail address", () => {
    const text = JSON.stringify([tenantSummary(), tenantDetail(), auditRow(), notice(), meReply()]);
    expect(text).not.toContain("@");
    expect(text).toMatch(/Osteria Demo A/);
  });
});

describe("the helpers' types are the final types", () => {
  it("each final type is assignable to the helper type it replaces", () => {
    expectTypeOf<TenantSummary>().toExtend<SortableTenant>();
    expectTypeOf<MfaFactor>().toEqualTypeOf<AccountFactor>();
    expectTypeOf<ReturnType<typeof accountStatus>>().toEqualTypeOf<AccountMfaStatus>();
    expectTypeOf<AuditRow["detail"]>().toExtend<Record<string, string | number | boolean | null>>();
    expectTypeOf<Notice>().toExtend<{
      pending: readonly unknown[];
      kind: string;
      version: number;
    }>();
  });
});
