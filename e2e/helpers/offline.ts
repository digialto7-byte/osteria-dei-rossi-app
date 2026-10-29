import { expect, type BrowserContext, type Page, type Response } from "@playwright/test";

// Helpers for the offline queue (M20). Every write of the order screen is a queued operation that POST /api/sync carries, so a spec
// waits for that call (and for the "In coda" marks to go) where it used to wait for a direct write endpoint.

/** The comanda address after a table is opened: `/tavoli/comanda?s=<session id>`. */
export const COMANDA_URL = /\/tavoli\/comanda\?s=[0-9a-f-]{36}$/;

/** The session id in a comanda address. */
export function sessionIdOf(url: string): string {
  const id = new URL(url).searchParams.get("s");
  if (!id) throw new Error(`No session in ${url}`);
  return id;
}

export const isSyncPost = (r: Response) =>
  new URL(r.url()).pathname === "/api/sync" && r.request().method() === "POST";

/** One operation as it travels in the body of POST /api/sync (only what the specs look at). */
export type WireOp = { opId: string; kind: string; seq?: number; payload?: unknown };
export type SyncReply = {
  results: { opId: string; kind: string; status: string }[];
  stopped: { opId: string; reason: string } | null;
};

/** The operations in the body of one /api/sync request. */
export function opsOf(request: { postData(): string | null }): WireOp[] {
  const body = JSON.parse(request.postData() ?? "{}") as { ops?: WireOp[] };
  return body.ops ?? [];
}

/** Starts waiting for the next 200 from POST /api/sync; await it after the action that causes it. */
export function nextSync(page: Page): Promise<Response> {
  return page.waitForResponse((r) => isSyncPost(r) && r.status() === 200);
}

/** Runs `act`, waits for the /api/sync call it causes and returns its JSON. */
export async function syncedAfter(page: Page, act: () => Promise<unknown>): Promise<SyncReply> {
  const [response] = await Promise.all([nextSync(page), act()]);
  return (await response.json()) as SyncReply;
}

/** Waits until the phone has nothing left to send: no "In coda" mark anywhere on the page. */
export async function expectNothingQueued(page: Page): Promise<void> {
  await expect(page.getByText(/In coda/)).toHaveCount(0);
}

/** The line ids on the sheet now (the sheet must be open). */
export async function lineIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-line-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-line-id")!));
}

/**
 * Cuts the browser's connection the way a dead Wi-Fi does: every request fails and `navigator.onLine` turns false. Playwright's
 * offline mode may or may not cut a service worker's own requests; pwa.spec.ts asks that question first.
 */
export async function goOffline(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
}

export async function goOnline(context: BrowserContext): Promise<void> {
  await context.setOffline(false);
}
