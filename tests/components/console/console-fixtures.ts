import {
  PLATFORM_API_SCHEMAS,
  accountMfaEnrolResponseSchema,
  accountMfaGetResponseSchema,
  auditRowSchema,
  meResponseSchema,
  noticeSchema,
  tenantDetailSchema,
  tenantSummarySchema,
  type AuditRow,
  type Notice,
  type TenantDetail,
  type TenantSummary,
} from "@/lib/platform/api";
import type { z } from "zod";

// Test data for the console screens, built from the documented examples of @/lib/platform/api (the final shapes of the API) and parsed by
// the real schemas, so a fixture can never drift from the contract. Fake names only. Not a .test.ts file: Vitest does not collect it.
const fresh = <S extends z.ZodType>(schema: S, example: unknown): z.infer<S> =>
  schema.parse(structuredClone(example));

export const DEMO_TENANT_ID = "a0000000-0000-4000-8000-00000000000a";
export const DEMO_TENANT_B_ID = "c0000000-0000-4000-8000-00000000000c";
export const DEMO_NOTICE_ID = "f0000000-0000-4000-8000-00000000000f";

export function tenantDetail(over: Partial<TenantDetail> = {}): TenantDetail {
  return {
    ...fresh(tenantDetailSchema, PLATFORM_API_SCHEMAS.tenantDetailResponse.example.tenant),
    ...over,
  };
}

export function tenantSummary(over: Partial<TenantSummary> = {}): TenantSummary {
  const { timeZone: _timeZone, bookingSlug: _bookingSlug, ...summary } = tenantDetail();
  return { ...fresh(tenantSummarySchema, summary), ...over };
}

export function auditRow(over: Partial<AuditRow> = {}): AuditRow {
  return {
    ...fresh(auditRowSchema, PLATFORM_API_SCHEMAS.auditResponse.example.rows[0]),
    ...over,
  };
}

export function notice(over: Partial<Notice> = {}): Notice {
  return {
    ...fresh(noticeSchema, PLATFORM_API_SCHEMAS.noticesResponse.example.notices[0]),
    ...over,
  };
}

export function meReply(over: Partial<z.infer<typeof meResponseSchema>> = {}) {
  return { ...fresh(meResponseSchema, PLATFORM_API_SCHEMAS.meResponse.example), ...over };
}

export function accountStatus(over: Partial<z.infer<typeof accountMfaGetResponseSchema>> = {}) {
  return {
    ...fresh(accountMfaGetResponseSchema, PLATFORM_API_SCHEMAS.accountMfaGetResponse.example),
    ...over,
  };
}

export function enrolReply(over: Partial<z.infer<typeof accountMfaEnrolResponseSchema>> = {}) {
  return {
    ...fresh(accountMfaEnrolResponseSchema, PLATFORM_API_SCHEMAS.accountMfaEnrolResponse.example),
    ...over,
  };
}
