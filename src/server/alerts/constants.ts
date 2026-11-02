/** One page of /avvisi. The list builder fetches one more row to know whether a next page exists. */
export const ALERT_LIST_PAGE_SIZE = 50;

/** How many open alerts the Home strip shows (M25b, Q219): `GET /api/alerts?filter=open&limit=3`. Never above the page size. */
export const HOME_ALERT_LIMIT = 3;
