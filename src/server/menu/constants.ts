/** Largest body of a write to the menu, table and coperto endpoints; a body is a few keys, so 4 KiB is generous. */
export const MAX_MENU_BODY_BYTES = 4096;
/** Mirrors menu_item.name (check in 20261031100000_menu_tables_core.sql). */
export const MENU_NAME_MAX = 80;
/** Mirrors menu_item.category. */
export const MENU_CATEGORY_MAX = 40;
/** Mirrors menu_item_price.price: a sale price, VAT included, 2 decimals. */
export const MENU_PRICE_MAX = 10_000;
/** Mirrors menu_item.position. */
export const MENU_POSITION_MAX = 9999;
/** Mirrors app.allowed_vat_rates(). */
export const VAT_RATES = [0, 4, 5, 10, 22] as const;
/** Mirrors public.course, in service order (PRD 3.2). */
export const COURSES = ["antipasti", "primi", "secondi", "dolci", "bevande"] as const;
export type Course = (typeof COURSES)[number];
