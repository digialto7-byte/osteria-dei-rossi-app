/** Staff PIN login constants (M11 plan §3.5). The lockout thresholds live in SQL only. */

/** A PIN is exactly four ASCII digits. */
export const PIN_LENGTH = 4;

/** Upper bound for one Supabase Auth call, under the 30 s pending-attempt window of the database. */
export const AUTH_CALL_TIMEOUT_MS = 10_000;

/** Crockford base32 without I, L, O, U: what an owner reads out and a waiter types. */
export const ENROLMENT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ENROLMENT_CODE_LENGTH = 8;
/** The longest code string the public route accepts (room for spaces and a dash). */
export const ENROLMENT_CODE_INPUT_MAX = 16;

export const DEVICE_TOKEN_BYTES = 32;
/** `__Host-` cookies need Secure, Path=/ and no Domain. */
export const DEVICE_COOKIE_NAME = "__Host-odr_device";
/** 400 days, the longest a browser keeps a cookie. */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** A reserved TLD (RFC 2606): the synthetic address of a PIN account can never receive mail. */
export const STAFF_EMAIL_DOMAIN = "staff.invalid";

/** Device labels and staff display names, as in SQL. */
export const LABEL_MAX_CHARS = 60;
export const DISPLAY_NAME_MAX_CHARS = 60;
