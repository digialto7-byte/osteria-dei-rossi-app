/** The most one staff-meal rule or confirmation can name; mirrors the checks of staff_meal_rule and _confirmation. */
export const STAFF_MEAL_COUNT_MAX = 1000;
/** The most rules per tenant; mirrors public.set_staff_meal_rule. */
export const STAFF_MEAL_RULES_MAX = 50;
/** A rule or a confirmation is a few dozen bytes; this only stops a runaway request before it is read. */
export const MAX_STAFF_MEAL_BODY_BYTES = 2048;
