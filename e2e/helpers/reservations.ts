import { expect, type Page } from "@playwright/test";
import { addDays } from "@/lib/time/venue-date";
import {
  moveToDay,
  seedRequest,
  type RequestSeed,
} from "../../tests/integration/helpers/reservations";
import { businessDateOf } from "./services";

// Helpers of the staff reservations spec (reservations plan A15), fake data only. Customer requests have no route in PR1, so one is seeded through psql
// (`seedRequest`, local stack only: `runSql` refuses any other host); everything else goes through the signed-in user's own screens and API calls.

export const CUSTOMER = "Cliente Demo";

/** Tomorrow's business date, as the app says it (GET /api/tables), never from the calendar. */
export async function tomorrowOf(page: Page): Promise<string> {
  return addDays(await businessDateOf(page), 1);
}

/** One pending request for tomorrow at 20:00 (Cena), as a customer would have sent it. */
export function seedCustomerRequest(
  tenantId: string,
  date: string,
  over: Partial<RequestSeed> = {},
): void {
  const reply = seedRequest(tenantId, {
    date,
    time: "20:00",
    serviceKey: "cena",
    party: 3,
    name: CUSTOMER,
    phone: "+39 000 0000001",
    email: "cliente.demo@example.com",
    ip: "203.0.113.21",
    ...over,
  });
  expect(JSON.parse(reply)).toEqual({ status: "received" });
}

/** The id of the booking of a named customer on a day, read as the signed-in owner. */
export async function reservationIdOf(page: Page, date: string, name: string): Promise<string> {
  const reply = await page.request.get(`/api/reservations?date=${date}`);
  expect(reply.status(), `reservations: ${await reply.text()}`).toBe(200);
  const day = (await reply.json()) as {
    services: { reservations: { id: string; name: string | null }[] }[];
  };
  const found = day.services.flatMap((s) => s.reservations).find((r) => r.name === name);
  if (!found) throw new Error("Fixture failed: the seeded booking is not listed");
  return found.id;
}

/** Puts a booking on today's business day, one hour from now, so a waiter can open its table whatever the clock of the run is. */
export async function bookingToday(page: Page, id: string): Promise<void> {
  moveToDay(id, await businessDateOf(page));
}
