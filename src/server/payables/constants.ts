/** Rows per page of GET /api/payables; mirrors the SQL default of public.payable_list. */
export const PAYABLE_LIST_PAGE_SIZE = 50;
/** audit_event.reason allows 1 to 200 characters; the same bound in SQL and in Zod. */
export const PAYABLE_REASON_MAX = 200;
/** A status change is a few dozen bytes; this only stops a runaway request before it is read. */
export const MAX_PAYABLE_BODY_BYTES = 4096;
