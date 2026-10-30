// Constants of the bill, the split and the close (M21 plan §3.5). Each mirrors a rule of the SQL migrations 20261110100000 to
// 20261110100200; tests/parity/close-sql-parity.test.ts keeps them in step. The SQL stays the authority.

/** Mirrors app.receipt_types(), in order. */
export const RECEIPT_TYPES = ["scontrino", "fattura"] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

/** Mirrors app.payment_type_codes(), in order (Q126: the project plan's example list). */
export const PAYMENT_TYPES = ["cash", "card", "other"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

/** A split by covers has 2 to 99 parts (app.bill_split_check, app.split_cents). */
export const MIN_SPLIT_PARTS = 2;
export const MAX_SPLIT_PARTS = 99;
/** A split by items has 2 to 20 groups and at most 200 line ids in all. */
export const MAX_SPLIT_GROUPS = 20;
export const MAX_SPLIT_IDS = 200;
/** Mirrors the check on table_session.receipt_number: RCH numbers such as "0012-0034", no spaces, at most 20 characters. */
export const RECEIPT_NUMBER = /^[0-9A-Za-z][0-9A-Za-z/.-]{0,19}$/;

/** A close body is four short keys. */
export const MAX_CLOSE_BODY_BYTES = 1024;
/** A split body: up to 200 uuids plus the JSON around them. */
export const MAX_SPLIT_BODY_BYTES = 16_384;
