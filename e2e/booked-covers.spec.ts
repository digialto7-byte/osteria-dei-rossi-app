import { expect, test, type Page } from "@playwright/test";
import { addDays } from "../src/lib/time/venue-date";
import { businessDateOf } from "./helpers/business-date";
import { main, newContext } from "./helpers/order-ui";
import { CUSTOMER, reservationIdOf, seedCustomerRequest } from "./helpers/reservations";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// P2-2 reservations V2 on a phone (360 x 740), Chromium only (`phone`): the chef sees the booked covers on Produzione as numbers only. A customer's request for
// tomorrow's dinner (3 covers) is seeded through psql, as the staff reservations spec does (local stack only). While it is pending the chef's panel says there
// is no confirmed booking; once the owner accepts it the panel shows "Cena" with 3 covers and 1 booking, and the page holds no guest name, phone or e-mail. The
// day is tomorrow, not today: a booking for today needs a start time still ahead, and a run late in the evening has none. Tomorrow comes from the business date
// (02:00 cut-off), and the last test reads that date again. Fake data only.
//   AT-P7 confirmed bookings only, counts only, the chef still has no reservation route   AT-P11 the business date

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

let fixture: { email: string; tenantId: string; day: string; tomorrow: string; id: string } | null =
  null;

function seeded() {
  if (!fixture) throw new Error("The beforeAll seeding did not run");
  return fixture;
}

test.beforeAll(async ({ browser }, testInfo) => {
  const { context, page } = await newContext(browser, testInfo.project.use);
  try {
    const email = createOwner();
    await signInWithMagicLink(page, email, "/");
    const tenantId = await tenantIdOf(page);
    const day = await businessDateOf(page);
    const tomorrow = addDays(day, 1);
    seedCustomerRequest(tenantId, tomorrow);
    fixture = {
      email,
      tenantId,
      day,
      tomorrow,
      id: await reservationIdOf(page, tomorrow, CUSTOMER),
    };
  } finally {
    await context.close();
  }
});

const booked = (page: Page) => main(page).getByText("Prenotati (confermati)");

test.describe("the chef", () => {
  test("sees no booking while the request is pending, then the covers once the owner accepts it", async ({
    page,
    browser,
  }, testInfo) => {
    const { email, tenantId, id } = seeded();
    await signInWithMagicLink(page, await createStaff(tenantId, "chef"));
    await page.goto("/produzione?previsione=domani");
    await expect(booked(page)).toBeVisible();
    await expect(main(page)).toContainText("Nessuna prenotazione confermata");

    // The owner (an independent session) accepts the request, with no table.
    const owner = await newContext(browser, testInfo.project.use);
    try {
      await signInWithMagicLink(owner.page, email);
      const accepted = await owner.page.request.post(`/api/reservations/${id}/accept`, {
        data: { tableIds: null, groupId: null },
      });
      expect(accepted.status(), await accepted.text()).toBe(200);
      expect(await businessDateOf(owner.page), "the run crossed the 02:00 cut-off").toBe(
        seeded().day,
      );
    } finally {
      await owner.context.close();
    }

    await page.goto("/produzione?previsione=domani");
    await expect(booked(page)).toBeVisible();
    const cena = main(page)
      .locator("li")
      .filter({ hasText: /Cena\s+3 coperti\s+·\s+1 prenotazione/ });
    await expect(cena).toHaveCount(1);
    await expect(main(page)).not.toContainText("Nessuna prenotazione confermata");
    // Numbers only: no guest name, phone or e-mail anywhere on the page.
    const html = await page.content();
    for (const secret of [CUSTOMER, "Cliente", "0000001", "cliente.demo"]) {
      expect(html, secret).not.toContain(secret);
    }
    await expectPhoneFriendly(page);
  });

  test("reads the covers from the API with exactly the counts, and gets 403 from the reservations", async ({
    page,
  }) => {
    const { tenantId, tomorrow } = seeded();
    await signInWithMagicLink(page, await createStaff(tenantId, "chef"));
    const covers = await page.request.get(`/api/reservations/covers?date=${tomorrow}`);
    expect(covers.status()).toBe(200);
    const body = (await covers.json()) as {
      businessDate: string;
      services: { key: string; name: string; reservations: number; covers: number }[];
    };
    expect(body.businessDate).toBe(tomorrow);
    expect(Object.keys(body).sort()).toEqual(["businessDate", "services"]);
    expect(body.services.find((service) => service.key === "cena")).toMatchObject({
      reservations: 1,
      covers: 3,
    });
    for (const service of body.services) {
      expect(Object.keys(service).sort()).toEqual(["covers", "key", "name", "reservations"]);
    }
    const day = await page.request.get(`/api/reservations?date=${tomorrow}`);
    expect(day.status()).toBe(403);
    expect(await day.text()).not.toContain("Cliente");
  });
});

test.describe("the run", () => {
  test("did not cross the 02:00 cut-off", async ({ page }) => {
    await signInWithMagicLink(page, seeded().email);
    expect(await businessDateOf(page), "the run crossed the 02:00 cut-off").toBe(seeded().day);
  });
});
