import { defineConfig, devices } from "@playwright/test";

// Chromium only: lets Playwright see, route and take offline the service worker's own requests. Without it `setOffline` stops the page
// but not the worker, so an "offline" spec would still read live data. WebKit has no such switch (its offline mode stops navigations
// before the worker); the offline spec covers that difference itself.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= "1";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const PERF_DIR = /[\\/]e2e[\\/]perf[\\/]/;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  // Phone-first: the app is used on staff phones (PRD), so tests run at phone size.
  projects: [
    {
      name: "phone",
      testIgnore: PERF_DIR,
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 740 } },
    },
    // M18: the order screen also runs on WebKit (an iPhone), the waiter's other likely phone. M19 adds the firing spec
    // (send and void on the same screen). Only those specs: the rest of the suite stays on Chromium to keep the CI minutes
    // down. M20 adds the offline spec (queue, replay, logout with pending operations); M21 adds the bill-close spec (the waiter's
    // bill, split and close); M25a adds session-persistence (cookie expiry and a relaunched browser stay signed in, on an iPhone's
    // engine too); the service worker spec (pwa) and the end-of-day spec (the owner's) are Chromium only.
    {
      name: "phone-webkit",
      testMatch: /(order-entry|firing|offline|bill-close|session-persistence)\.spec\.ts$/,
      testIgnore: PERF_DIR,
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
      testIgnore: PERF_DIR,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    // M22: the dashboard's "Ieri" tile on a simulated Slow 4G connection, against the STAGING app. Only e2e/perf/, only Chromium (the
    // network throttle is a DevTools command), and only from the perf-dashboard-4g workflow: the spec skips itself without that
    // workflow's opt-in, and no other project runs the folder.
    {
      name: "perf-4g",
      testMatch: PERF_DIR,
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: {
    // `npm run build` runs first (CI step), so tests hit the production server. Idle sockets are kept for 10 minutes, not
    // Node's 5 s: Playwright's `page.request` pool reuses idle sockets with no limit of its own, and a request written just
    // as the server closes one was reset (`read ECONNRESET`, CI 2026-11-04). See tests/config/e2e-web-server.test.ts.
    command: `npm run start -- --port ${PORT} --keepAliveTimeout 600000`,
    url: `${BASE_URL}/api/health`,
    // The server's own output in the job log (stderr is piped by default), so a failure shows what the server said.
    stdout: "pipe",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // The sign-in timing floor (ADR-029) is skipped for the local stack only: about 135 e2e sign-ins would
    // otherwise each wait 800 ms. authFloorMs ignores this for any Supabase that is not on this machine.
    env: { E2E_AUTH_FLOOR_OFF: "1" },
  },
});
