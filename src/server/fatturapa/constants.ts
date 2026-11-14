/**
 * Limits of the e-invoice reader. Each is pinned by a test, and the SQL twins (bodies, lines) by a
 * parity test that reads the migration text.
 */

/** DER/BER reader (p7m envelope). */
export const CMS_MAX_DEPTH = 16;
export const CMS_MAX_TLVS = 10_000;
/** A definite length is written in at most this many bytes (up to 4 GiB, then bounded by the input). */
export const CMS_MAX_LENGTH_BYTES = 4;
/** A p7m inside a p7m (parallel signatures produce .p7m.p7m): the outer one is level 1. */
export const CMS_MAX_ENVELOPES = 3;
