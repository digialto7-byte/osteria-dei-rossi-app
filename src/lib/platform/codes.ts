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

// Error codes of section 3.4. The eight new ones join ErrorCode in src/lib/api/errors.ts (step 17).
export const PLATFORM_NEW_ERROR_CODES = [
  "console_selection_required",
  "console_session",
  "console_switch_failed",
  "not_console_account",
  "mfa_factor_required",
  "tenant_not_found",
  "notice_not_found",
  "digialto_not_attached",
] as const;
export type PlatformNewErrorCode = (typeof PLATFORM_NEW_ERROR_CODES)[number];

/** Section 3.4.1: on every non-public route. */
export const PLATFORM_COMMON_ERROR_CODES = [
  "unauthenticated",
  "session_expired",
  "internal",
] as const;
/** Section 3.4.1: on every route of access kind { platform: true }, besides the common ones. */
export const PLATFORM_PLATFORM_ERROR_CODES = [
  "console_selection_required",
  "mfa_required",
  "mfa_factor_required",
  "forbidden",
] as const;
