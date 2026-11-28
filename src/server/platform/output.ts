import { z } from "zod";
import {
  auditResponseSchema,
  meResponseSchema,
  noticeNotifiedResponseSchema,
  noticeSchema,
  tenantDetailResponseSchema,
  tenantSummarySchema,
} from "@/lib/platform/api";

// SP3 step 17 (plan §3.4.1): what each console function returns, parsed with the same schemas the screens use (src/lib/platform/api.ts).
export const dbTenants = z.array(tenantSummarySchema);
export const dbTenant = tenantDetailResponseSchema;
export const dbAudit = auditResponseSchema;
export const dbNotices = z.array(noticeSchema);
export const dbNoticeMark = noticeNotifiedResponseSchema;
export const dbMe = meResponseSchema;
export const dbOpenTenant = z.strictObject({ tenantId: z.uuid(), attached: z.boolean() });

/** A console path id: a lowercase uuid. Anything else is the same 404 as a missing row (withApi's params rule). */
export const platformIdParams = z.object({
  id: z.uuid().refine((v) => v === v.toLowerCase()),
});
export const emptyBody = z.strictObject({});
