import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";

// GDPR (EU venue): the faces are downloaded by next/font at build time and served from
// /_next/static/media. Neither the build output nor the running app may point at Google.
const GOOGLE_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/;
const BUILD_DIRS = [".next/static", ".next/server/app"];
const TEXT_FILE = /\.(css|js|html|rsc|body|json)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test("the production build references no Google Fonts host and ships its own font files", () => {
  const root = process.cwd();
  for (const dir of BUILD_DIRS)
    expect(existsSync(join(root, dir)), `${dir} (run npm run build)`).toBe(true);

  const built = BUILD_DIRS.flatMap((dir) => files(join(root, dir)));
  const offenders = built
    .filter((file) => TEXT_FILE.test(file))
    .filter((file) => GOOGLE_FONT_HOSTS.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));
  expect(offenders).toEqual([]);
  expect(built.filter((file) => file.endsWith(".woff2")).length).toBeGreaterThan(0);
});

test("the login page loads its fonts from the app itself, never from Google", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  await page.goto("/login");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");

  expect(requested.filter((url) => GOOGLE_FONT_HOSTS.test(url))).toEqual([]);
  const fontRequests = requested.filter((url) => /\.woff2(\?|$)/.test(url));
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests) {
    expect(new URL(url).pathname).toMatch(/^\/_next\/static\/media\//);
    expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  }

  // The faces really are in use: the serif heading and the hyperlegible body text.
  const heading = page.getByRole("heading", { name: "Accedi" });
  expect(await heading.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Instrument/);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/Atkinson/);
  expect(await page.evaluate(() => document.fonts.check('16px "Atkinson Hyperlegible"'))).toBe(
    true,
  );
});
