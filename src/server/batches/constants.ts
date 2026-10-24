/** The largest actual output of one production, in the recipe's output unit; mirrors the bound of recipe.output_qty. */
export const BATCH_OUTPUT_MAX = 100_000;
/** The most portions of one batch; mirrors the bound of recipe.portions_per_batch. */
export const BATCH_PORTIONS_MAX = 10_000;
/** The longest shelf life, in hours (one year); mirrors the bound of recipe.shelf_life_hours. */
export const SHELF_LIFE_HOURS_MAX = 8760;
/** The most inputs of one production; matches the 100 line positions of a recipe. */
export const BATCH_INPUTS_MAX = 100;
/** Batches per page of GET /api/batches; mirrors the SQL default of public.batch_list. */
export const BATCH_LIST_PAGE_SIZE = 50;
export const BATCH_LIST_PAGE_MAX = 100;
/** A production body is a few hundred bytes per input; this only stops a runaway request before it is read. */
export const MAX_BATCH_BODY_BYTES = 16_384;
/** A batch is "due soon" within this many hours of its use-by (PRD 2.4); the SQL is app.use_by_state. */
export const USE_BY_SOON_HOURS = 24;
/** The most portions one count or discard can name, 4 decimals; mirrors the checks of adjust_batch and discard_batch. */
export const BATCH_COUNT_MAX = 10_000;
/** The movements public.batch_detail returns, newest first. */
export const BATCH_HISTORY_LIMIT = 100;
/** The body of an adjust, discard or split is a few dozen bytes; this only stops a runaway request. */
export const MAX_ACTION_BODY_BYTES = 2048;
