// SP3 step 21a (plan sections 3.1.3 and 3.4.2): the code lists the console shares with the database. Client-importable: no server or Supabase import.
// platform.audit_actions() in SQL equals PLATFORM_AUDIT_ACTIONS (sp3-preserves compares them from step 2 on). Later milestones add theirs to both lists.

export const PLATFORM_AUDIT_ACTIONS = [
  "platform_admin.bootstrapped",
  "platform_admin.factor_enrolled",
  "console.entered",
  "console.left",
  "console.tenant_opened",
  "notice.created",
  "notice.tenant_notified",
  "script.create_tenant",
  "script.mfa_reset",
  "script.set_mfa_enforcement",
] as const;
export type AuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

export const PLATFORM_AUDIT_ORIGINS = ["console", "script"] as const;
export type AuditOrigin = (typeof PLATFORM_AUDIT_ORIGINS)[number];

export const PLATFORM_NOTICE_KINDS = ["subprocessor"] as const;
export type NoticeKind = (typeof PLATFORM_NOTICE_KINDS)[number];
