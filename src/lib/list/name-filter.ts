/**
 * The name filter of the long lists (UX plan P2-6). Presentational only: it narrows rows the API already returned and
 * computes nothing about them.
 */

/** Lowercase, without accents and with single spaces, so "Crème  FRAÎCHE" and "creme fraiche" are the same name. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The items whose name contains the query, in their order; an empty or blank query keeps them all. */
export function filterByName<Item extends { name: string }>(
  items: readonly Item[],
  query: string,
): Item[] {
  const wanted = normalizeName(query);
  if (wanted === "") return [...items];
  return items.filter((item) => normalizeName(item.name).includes(wanted));
}
