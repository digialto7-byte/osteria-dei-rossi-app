/** Entries per page of GET /api/audit; mirrors the SQL default of public.audit_log. */
export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_PAGE_MAX = 100;
/** The longest range of the activity log, in days (inclusive); mirrors public.audit_log. */
export const AUDIT_RANGE_MAX_DAYS = 366;
