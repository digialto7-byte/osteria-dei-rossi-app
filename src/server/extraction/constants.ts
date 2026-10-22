// Extraction constants (M3 plan §3), each named once. Later steps add the rest of the table.

/** Shortest CRON_SECRET accepted (`openssl rand -hex 32` gives 64). */
export const MIN_CRON_SECRET_CHARS = 32;
