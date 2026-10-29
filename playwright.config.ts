import { defineConfig, devices } from "@playwright/test";

// Chromium only: lets Playwright see, route and take offline the service worker's own requests. Without it `setOffline` stops the page
// but not the worker, so an "offline" spec would still read live data. WebKit has no such switch (its offline mode stops navigations
// before the worker); the offline spec covers that difference itself.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= "1";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  // Phone-first: the app is used on staff phones (PRD), so tests run at phone size.
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 740 } } },
    // M18: the order screen also runs on WebKit (an iPhone), the waiter's other likely phone. M19 adds the firing spec
    // (send and void on the same screen). Only those specs: the rest of the suite stays on Chromium to keep the CI minutes
    // down. M20 adds the offline spec (queue, replay, logout with pending operations); the service worker spec (pwa) is
    // Chromium only.
    {
      name: "phone-webkit",
      testMatch: /(order-entry|firing|offline)\.spec\.ts$/,
      // Workers blocked: with one in control Playwright's WebKit does not apply route() or setOffline() to the page's requests, so
      // the held and failed /api/sync calls these specs rely on never happened. WebKit covers the queue and IndexedDB here; the worker
      // is covered in Chromium (pwa.spec.ts) and on real iPhones.
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 360, height: 740 },
        serviceWorkers: "block",
      },
    },
    // M19: the kitchen list is also read on a laptop or tablet at the pass. Only the kitchen spec (Chromium is installed).
    {
      name: "laptop",
      testMatch: /kitchen\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // `npm run build` runs first (CI step), so tests hit the production server.
    command: `npm run start -- --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
