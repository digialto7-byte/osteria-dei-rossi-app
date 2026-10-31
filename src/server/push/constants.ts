// Constants of the push list, the forecast and the push endpoint (M23 plan §3.4). Each mirrors a rule of the SQL migrations 20261114100300
// and 20261114100400; tests/parity/push-sql-parity.test.ts keeps them in step. The SQL stays the authority.

/** The forecast averages this many past weeks (PRD 4.4): app.forecast_weeks(). */
export const FORECAST_WEEKS = 4;
/** The forecast API accepts a date up to this many days after today: app.forecast_days_ahead(). */
export const FORECAST_DAYS_AHEAD = 6;
/** A batch is on the push list when its use-by is within this many hours (PRD 2.4): app.use_by_state's due-soon window. */
export const PUSH_LIST_WINDOW_HOURS = 24;
/** A push body is a boolean and a price; 256 bytes is generous. */
export const PUSH_BODY_MAX_BYTES = 256;
/** Mirrors menu_push.push_price and menu_item.push_price. */
export const PUSH_PRICE_MAX = 10_000;
