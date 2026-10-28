import { defineConfig, devices } from "@playwright/test";

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
    // M18: the order screen also runs on WebKit (an iPhone), the waiter's other likely phone. Only that spec: the
    // rest of the suite stays on Chromium to keep the CI minutes down.
    {
      name: "phone-webkit",
      testMatch: /order-entry\.spec\.ts$/,
      use: { ...devices["iPhone 13"], viewport: { width: 360, height: 740 } },
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
