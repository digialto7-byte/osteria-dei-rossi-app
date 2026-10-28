import { MAX_MENU_BODY_BYTES } from "@/server/menu/constants";

/** Same 4 KiB ceiling as the menu endpoints. */
export const MAX_TABLES_BODY_BYTES = MAX_MENU_BODY_BYTES;
/** Mirrors table_session.covers (1 to 99). */
export const MAX_TABLE_COVERS = 99;
/** Mirrors sale_settings.coperto_amount and table_session.coperto_amount: per person, VAT included. */
export const MAX_COPERTO_EUR = 100;
/** Mirrors dining_table.name. */
export const TABLE_NAME_MAX = 40;
/** Mirrors dining_table.position. */
export const TABLE_POSITION_MAX = 9999;
/** The waiter's table grid refetches this often while the page is visible (plan §3.5). */
export const TABLES_REFRESH_MS = 15_000;
