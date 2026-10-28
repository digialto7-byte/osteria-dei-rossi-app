import { ALERT_LIST_PAGE_SIZE } from "@/server/alerts/constants";

/**
 * How many open alerts "Oggi" counts. It is one page of /avvisi, so the number on Oggi is never larger than what the
 * list shows; past it the card says "more" instead of a bigger number.
 */
export const TODAY_ALERT_CAP = ALERT_LIST_PAGE_SIZE;
