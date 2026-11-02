import { expect, type Page } from "@playwright/test";
import type { DayServices, ServicePeriods } from "@/server/services/output";

// Helpers of the services spec and of the M25 simulation (plan §3.9, M25c step 17). Everything goes through the signed-in user's own API calls
// (`page.request`). Tables open at the wall-clock time, so a spec never expects a time-derived key: it places tables with `setTableService`, right after
// the closes, while the day is not final (an override after the cut-off plus 10 minutes gets 409 service_day_final). Fake data only.

export interface ServicePeriodInput {
  key: string | null;
  name: string;
  startsAt: string;
}

/** The two default services, as the owner would save them back. */
export const DEFAULT_SERVICES: ServicePeriodInput[] = [
  { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
  { key: "cena", name: "Cena", startsAt: "16:00" },
];

/** PATCH /api/settings/services as the signed-in owner or admin; returns the saved periods. */
export async function setServices(
  page: Page,
  periods: ServicePeriodInput[],
): Promise<ServicePeriods> {
  const reply = await page.request.patch("/api/settings/services", { data: { periods } });
  expect(reply.status(), `services: ${await reply.text()}`).toBe(200);
  return (await reply.json()) as ServicePeriods;
}

/** POST /api/table-sessions/:id/service as the signed-in owner or admin; a key, or null for "automatic". */
export async function setTableService(
  page: Page,
  sessionId: string,
  serviceKey: string | null,
): Promise<void> {
  const reply = await page.request.post(`/api/table-sessions/${sessionId}/service`, {
    data: { serviceKey },
  });
  expect(reply.status(), `service of ${sessionId}: ${await reply.text()}`).toBe(200);
}

/** GET /api/day-close/services?date= as the signed-in owner or admin. */
export async function dayServices(page: Page, date: string): Promise<DayServices> {
  const reply = await page.request.get(`/api/day-close/services?date=${date}`);
  expect(reply.status(), `day services: ${await reply.text()}`).toBe(200);
  return (await reply.json()) as DayServices;
}

/** Today's business date as the app says it (GET /api/tables), never from the calendar. */
export async function businessDateOf(page: Page): Promise<string> {
  const reply = await page.request.get("/api/tables");
  expect(reply.status()).toBe(200);
  return ((await reply.json()) as { businessDate: string }).businessDate;
}
