import { z } from "zod";

// M25b (plan §3.1.9): the "Dal / Al / Fornitore" filters of Fatture and Pagamenti live in the page address under Italian keys (dal, al,
// fornitore; stato on Pagamenti) and go to the API under English ones (from, to, supplier). Pure: no React, no fetch. An invalid value in the
// address is ignored (the field shows empty) and never sent.

export interface ListFilters {
  dal?: string | null;
  al?: string | null;
  fornitore?: string | null;
}

export type PayableFilterValue = "unpaid" | "paid" | "all";

const ISO_DATE = z.iso.date();
const UUID = z.uuid();

interface ParamSource {
  get(name: string): string | null;
}

const validDate = (value: string | null): string | null =>
  value !== null && ISO_DATE.safeParse(value).success ? value : null;

/** The three filters of a page address; each invalid or absent key is null. */
export function readListFilters(params: ParamSource): Required<ListFilters> {
  const supplier = params.get("fornitore");
  return {
    dal: validDate(params.get("dal")),
    al: validDate(params.get("al")),
    fornitore: supplier !== null && UUID.safeParse(supplier).success ? supplier : null,
  };
}

/** The API query string for the filters (`from`, `to`, `supplier`); absent keys are omitted. No leading `?`. */
export function toApiQuery(filters: ListFilters): string {
  const query = new URLSearchParams();
  if (filters.dal) query.set("from", filters.dal);
  if (filters.al) query.set("to", filters.al);
  if (filters.fornitore) query.set("supplier", filters.fornitore);
  return query.toString();
}

/** The page address for the filters (dal, al, fornitore, in that order) plus extra keys such as `stato`; the bare path when nothing is set. */
export function toPageHref(
  path: string,
  filters: ListFilters,
  extra: Record<string, string | null | undefined> = {},
): string {
  const query = new URLSearchParams();
  if (filters.dal) query.set("dal", filters.dal);
  if (filters.al) query.set("al", filters.al);
  if (filters.fornitore) query.set("fornitore", filters.fornitore);
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export const hasActiveFilters = (filters: ListFilters): boolean =>
  Boolean(filters.dal || filters.al || filters.fornitore);

/** True when both dates are set and the start is after the end (ISO dates compare as text). */
export const rangeInvalid = (filters: ListFilters): boolean =>
  Boolean(filters.dal && filters.al && filters.dal > filters.al);

/** `stato=pagate` is "Pagate", `stato=tutte` is "Tutte"; anything else, or nothing, is "Da pagare". */
export function readPayableStato(params: ParamSource): PayableFilterValue {
  const stato = params.get("stato");
  if (stato === "pagate") return "paid";
  if (stato === "tutte") return "all";
  return "unpaid";
}
