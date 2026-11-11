import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { main, newContext } from "./helpers/order-ui";
import { seedReports, type ReportsSeed } from "./helpers/seed-reports";
import { createWaiter, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M24 on a phone (360 x 740), Chromium only (`phone`; the `phone-webkit` project's testMatch does not include this file): the "Scarica CSV" link on
// /report, the monthly pack /report/mese, the print result, and who may export. The data is the M22 reports seed (a waiter sells and closes two
// tables, the owner counts the stock twice); the server clock cannot be moved here, so the sales are on today's business date and are not final.
// Rows are found by data attributes, never by position; headings by their exact name, scoped to `main`; the alert is scoped to `main` (the Next.js
// route announcer is a role=alert too); no `.first()` or `.last()`; no toggle is added, so no `aria-expanded` check is needed. Every date comes from
// the seed (the business date the app shows), not the calendar. Fake data only.
//   AT1  the downloaded file equals the API (T3: `kpis.csv` reaches `[file]`, `monthly-pack` the static segment)
//   AT3  the four sections, the print emulation (no navigation, light ink on paper) and the A4 page (T1)    AT4  the chef and the waiter

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

let owner: { email: string; tenantId: string; seed: ReportsSeed } | null = null;

// Serial mode re-runs this in a fresh worker after a failure, which seeds a new tenant: no test depends on another.
test.beforeAll(async ({ browser }, testInfo) => {
  const { context, page } = await newContext(browser, testInfo.project.use);
  const waiterContext = await newContext(browser, testInfo.project.use);
  try {
    const email = createOwner();
    await signInWithMagicLink(page, email, "/");
    const tenantId = await tenantIdOf(page);
    await signInWithMagicLink(
      waiterContext.page,
      await createWaiter(tenantId, WAITER_A),
      "/tavoli",
    );
    owner = { email, tenantId, seed: await seedReports(page, waiterContext.page, tenantId) };
  } finally {
    await waiterContext.context.close();
    await context.close();
  }
});

const BOM = [0xef, 0xbb, 0xbf];

/** The title of the pack for a month, built here (not with the app's helper): "Pacchetto mensile · ottobre 2026". */
const packTitle = (month: string) =>
  `Pacchetto mensile · ${new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`))}`;

/**
 * Taps the link and reads the file the browser saved: its name, its first bytes and its text without the BOM.
 * The saved file is deleted before the test ends (`download.delete()`), so no download artifact is left for the context teardown.
 * Hygiene, not a proven fix (cause of the exports e2e failure on #67/#74 unknown).
 */
async function downloadFrom(page: Page, link: ReturnType<Page["getByRole"]>) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    link.click(),
  ]);
  let bytes: Buffer;
  try {
    bytes = readFileSync((await download.path())!);
  } finally {
    await download.delete().catch(() => {});
  }
  return {
    name: download.suggestedFilename(),
    head: [...bytes.subarray(0, 3)],
    text: bytes.subarray(3).toString("utf8"),
  };
}

test.describe("Scarica CSV for the owner and the admin", () => {
  test("the owner's file from /report equals the API (AT1) and starts with a BOM", async ({
    page,
  }) => {
    await signInWithMagicLink(page, owner!.email);
    const { day } = owner!.seed;
    const api = await page.request.get(`/api/reports/kpis?period=day&date=${day}`);
    expect(api.status()).toBe(200);
    const current = ((await api.json()) as { current: { covers: number } }).current;

    await page.goto(`/report?vista=andamento&periodo=giorno&data=${day}`);
    await expect(main(page).getByRole("heading", { name: "Report", exact: true })).toBeVisible();
    const link = main(page).getByRole("link", { name: "Scarica CSV", exact: true });
    await expect(link).toHaveAttribute("href", `/api/exports/kpis.csv?period=day&date=${day}`);
    const file = await downloadFrom(page, link);

    expect(file.head).toEqual(BOM);
    expect(file.name).toMatch(/^report-kpis-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.text.split("\r\n");
    expect(lines[0]).toBe("chiave;voce;valore;valore_precedente;differenza;differenza_pct");
    expect(lines).toHaveLength(54 + 2); // header, 54 rows, and the empty piece after the last CRLF
    expect(lines[55]).toBe("");
    const covers = lines.find((line) => line.startsWith("covers;"))!.split(";");
    expect(covers[2]).toBe(String(current.covers));
    await expectPhoneFriendlyBothThemes(page);
  });

  test("T3: the route answers over HTTP, for a slug with a dot and for the static monthly-pack segment", async ({
    page,
  }) => {
    await signInWithMagicLink(page, owner!.email);
    const { day } = owner!.seed;
    const csv = await page.request.get(`/api/exports/kpis.csv?period=day&date=${day}`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers()["content-disposition"]).toMatch(/^attachment; filename="report-kpis-/);
    expect(csv.headers()["cache-control"]).toBe("no-store");
    const unknown = await page.request.get("/api/exports/nope.csv");
    expect(unknown.status()).toBe(404);
    const pack = await page.request.get("/api/exports/monthly-pack");
    expect(pack.status()).toBe(200);
    expect(pack.headers()["content-type"]).toMatch(/application\/json/);
    expect(((await pack.json()) as { month: string }).month).toMatch(/^\d{4}-\d{2}$/);
  });

  test("the owner's items file has the fixed-cost columns", async ({ page }) => {
    await signInWithMagicLink(page, owner!.email);
    const { day } = owner!.seed;
    await page.goto(`/report?vista=piatti&periodo=giorno&data=${day}`);
    const link = main(page).getByRole("link", { name: "Scarica CSV", exact: true });
    await expect(link).toBeVisible();
    const file = await downloadFrom(page, link);
    expect(file.text.split("\r\n")[0]).toContain("costo_fisso_per_piatto_eur");
  });

  test("the admin's items file has no fixed-cost column", async ({ page }) => {
    await signInWithMagicLink(page, await createStaff(owner!.tenantId, "admin"));
    const { day } = owner!.seed;
    await page.goto(`/report?vista=piatti&periodo=giorno&data=${day}`);
    const link = main(page).getByRole("link", { name: "Scarica CSV", exact: true });
    await expect(link).toBeVisible();
    const file = await downloadFrom(page, link);
    expect(file.head).toEqual(BOM);
    expect(file.text.split("\r\n")[0]).not.toContain("costo_fisso_per_piatto_eur");
    expect(file.text.split("\r\n")[0]).toContain("menu_item_id;piatto;");
  });

  test("the owner has the link on the push list as well", async ({ page }) => {
    await signInWithMagicLink(page, owner!.email);
    await page.goto("/spingere");
    await expect(
      main(page).getByRole("heading", { name: "Da spingere", exact: true }),
    ).toBeVisible();
    await expect(
      main(page).getByRole("link", { name: "Scarica CSV", exact: true }),
    ).toHaveAttribute("href", "/api/exports/push-list.csv");
  });
});

test.describe("the monthly pack (AT3)", () => {
  test("/report/mese shows the four sections, and the API answers for the same month", async ({
    page,
  }) => {
    await signInWithMagicLink(page, owner!.email);
    const month = owner!.seed.day.slice(0, 7);
    await page.goto("/report");
    await main(page).getByRole("link", { name: "Pacchetto mensile", exact: true }).click();
    await expect(page).toHaveURL(/\/report\/mese$/);

    await page.goto(`/report/mese?mese=${month}`);
    await expect(
      main(page).getByRole("heading", { level: 1, name: packTitle(month), exact: true }),
    ).toBeVisible();
    for (const name of ["Indicatori", "Acquisti", "Sprechi", "Scostamenti"]) {
      await expect(main(page).getByRole("heading", { name, exact: true })).toBeVisible();
    }
    const api = await page.request.get(`/api/exports/monthly-pack?month=${month}`);
    expect(api.status()).toBe(200);
    const body = (await api.json()) as { month: string; kpis: { current: { covers: number } } };
    expect(body.month).toBe(month);
    await expect(main(page).locator('[data-kpi="covers"]')).toContainText(
      String(body.kpis.current.covers),
    );
    await expectPhoneFriendlyBothThemes(page);
  });

  test("B5: the page starts with its back link to /report, before the title", async ({ page }) => {
    await signInWithMagicLink(page, owner!.email);
    const month = owner!.seed.day.slice(0, 7);
    await page.goto(`/report/mese?mese=${month}`);
    await expect(
      main(page).getByRole("heading", { level: 1, name: packTitle(month), exact: true }),
    ).toBeVisible();
    const first = await page.evaluate(() => {
      const link = [...document.querySelectorAll<HTMLAnchorElement>("main a")].find(
        (a) => !a.closest("nav"),
      );
      const heading = document.querySelector("main h1");
      return {
        href: link?.getAttribute("href") ?? null,
        beforeHeading:
          !!link &&
          !!heading &&
          !!(link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(first).toEqual({ href: "/report", beforeHeading: true });
  });

  test("on paper: no navigation, no controls, light ink, the four sections and an A4 page (T1)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, owner!.email);
    const month = owner!.seed.day.slice(0, 7);
    await page.goto(`/report/mese?mese=${month}`);
    await expect(
      main(page).getByRole("heading", { level: 1, name: packTitle(month), exact: true }),
    ).toBeVisible();
    await expect(
      main(page).getByRole("heading", { name: "Scostamenti", exact: true }),
    ).toBeVisible();
    // On screen the navigation, the print button and the back link are all there: the toBeHidden() checks below mean something.
    const printButton = main(page).getByRole("button", { name: "Stampa o salva PDF", exact: true });
    // On a phone the section row inside main also has a "Report" link (the current page, aria-current): the back link is the other one.
    const backLink = main(page)
      .getByRole("link", { name: "Report", exact: true })
      .and(main(page).locator("a:not([aria-current])"));
    await expect(page.getByRole("navigation")).not.toHaveCount(0);
    await expect(printButton).toBeVisible();
    await expect(backLink).toBeVisible();

    // A phone in dark mode still prints light ink on light paper.
    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(printButton).toBeHidden();
    await expect(backLink).toBeHidden();
    for (const name of ["Indicatori", "Acquisti", "Sprechi", "Scostamenti"]) {
      await expect(main(page).getByRole("heading", { name, exact: true })).toBeVisible();
    }
    const ink = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(ink).toBe("rgb(15, 15, 13)");

    const pdf = await page.pdf({ preferCSSPageSize: true });
    // A4 is 595 x 842 points. T1: if Chromium writes other numbers, widen this to the observed A4 values and say so here.
    expect(pdf.toString("latin1")).toMatch(
      /\/MediaBox\s*\[\s*0 0 59[45](\.\d+)? 84[12](\.\d+)?\s*\]/,
    );
    await page.emulateMedia({ media: "screen", colorScheme: "light" });
  });
});

test.describe("who may export (AT4)", () => {
  test("the chef sees no link on the push list; the API answers 403 for the file and the pack", async ({
    page,
  }) => {
    await signInWithMagicLink(page, await createStaff(owner!.tenantId, "chef"), "/");
    await page.goto("/spingere");
    await expect(
      main(page).getByRole("heading", { name: "Da spingere", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(main(page).getByRole("link", { name: "Scarica CSV", exact: true })).toHaveCount(0);
    expect((await page.request.get("/api/exports/kpis.csv")).status()).toBe(403);
    expect((await page.request.get("/api/exports/push-list.csv")).status()).toBe(403);
    expect((await page.request.get("/api/exports/monthly-pack")).status()).toBe(403);
  });

  test("the waiter gets 403 from the API for the file and the pack", async ({ page }) => {
    await signInWithMagicLink(page, await createStaff(owner!.tenantId, "waiter"), "/tavoli");
    expect((await page.request.get("/api/exports/kpis.csv")).status()).toBe(403);
    expect((await page.request.get("/api/exports/monthly-pack")).status()).toBe(403);
  });

  test("the chef opening /report/mese gets the reserved message and no section", async ({
    page,
  }) => {
    await signInWithMagicLink(page, await createStaff(owner!.tenantId, "chef"), "/");
    await page.goto("/report/mese");
    await expect(main(page).getByRole("alert")).toContainText(
      "I report sono riservati al titolare e all'amministratore.",
    );
    await expect(main(page).getByRole("heading", { name: "Indicatori", exact: true })).toHaveCount(
      0,
    );
  });
});
