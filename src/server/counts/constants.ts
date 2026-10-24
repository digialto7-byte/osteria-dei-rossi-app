/** The largest counted quantity of one line, in base units (kg, l or pz); a typo guard. Mirrors app.count_qty_base. */
export const COUNT_QTY_MAX = 100_000;
/** Lines per call of PUT /api/counts/:id/lines (a monthly count is saved in pages). Mirrors public.count_record_lines. */
export const COUNT_LINES_MAX_PER_CALL = 200;
/** Sessions per page of GET /api/counts; mirrors the SQL default of public.count_sessions. */
export const COUNT_LIST_PAGE_SIZE = 20;
export const COUNT_LIST_PAGE_MAX = 100;
/** The longest range of the reconciliation report, in days (inclusive); mirrors public.stock_reconciliation. */
export const RECONCILIATION_RANGE_MAX_DAYS = 366;
/** A page of 200 lines is about 20 KB; this only stops a runaway request before it is read. */
export const MAX_COUNT_BODY_BYTES = 65_536;
