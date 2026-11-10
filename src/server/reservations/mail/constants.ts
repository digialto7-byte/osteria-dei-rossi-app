/** Rows one run of the mail cron claims (`reservation_mail_claim`, 1 to 50). */
export const MAIL_BATCH = 10;

/** `maxDuration` of the mail route (the route needs a literal; a test pins it to this). A full batch of sends that all hit the 10 s timeout still fits. */
export const MAIL_MAX_DURATION_S = 120;
