import type { Page } from "@playwright/test";

// The business date a signed-in owner's screens use, for seeds that must date an invoice (receipts count by their invoice date, the rest of the
// ledger by business-day instants) so that it falls inside a report whose default end is the business date. Between 00:00 and the tenant's cut-off
// (02:00 by default) that date is the day BEFORE the Rome calendar date, so `venueDate(new Date())` is a day too late for those reads.
// The cut-off is tenant data and the web tier has no copy of it, so the date is read where the app reads it: GET /api/stock/waste-costs without
// dates ends its range on `public.business_date_of(now)` (owner and admin only; the function is granted to `authenticated` and checks the tenant,
// so the service role is never used). Its `to` is that date. Nothing is written.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The `to` of the waste-costs answer, as a valid ISO date. Throws on anything else, so a changed route fails loudly. */
export function parseBusinessDate(body: unknown): string {
  const to = typeof body === "object" && body !== null ? (body as { to?: unknown }).to : undefined;
  if (
    typeof to !== "string" ||
    !ISO_DATE.test(to) ||
    Number.isNaN(Date.parse(`${to}T00:00:00Z`)) ||
    new Date(`${to}T00:00:00Z`).toISOString().slice(0, 10) !== to
  ) {
    throw new Error(`not a business date in the waste-costs answer: ${JSON.stringify(to)}`);
  }
  return to;
}

/** The tenant's business date right now, read as the signed-in owner (or admin) `owner`. */
export async function businessDateOf(owner: Page): Promise<string> {
  const reply = await owner.request.get("/api/stock/waste-costs");
  if (reply.status() !== 200) {
    throw new Error(`GET /api/stock/waste-costs answered ${reply.status()}: ${await reply.text()}`);
  }
  return parseBusinessDate(await reply.json());
}
