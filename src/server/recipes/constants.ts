/** Highest yield factor accepted: a typo guard (82 typed for 0,82). Mirrors recipe_line's check. */
export const MAX_YIELD_FACTOR = 10;
/** Lines in one recipe version. */
export const MAX_RECIPE_LINES = 100;
/** The list endpoint's bound; one venue has far fewer recipes. */
export const RECIPE_LIST_LIMIT = 500;
/** A recipe body is a few KB; this only stops a runaway request before it is read. */
export const MAX_RECIPE_BODY_BYTES = 262_144;

export const MAX_NAME_LENGTH = 120;
export const MAX_QTY = 100_000;
