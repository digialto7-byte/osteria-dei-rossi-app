import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";

// GDPR (EU venue): the faces are committed woff2 files (src/app/fonts) loaded by next/font/local and served from
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

// The families the screens use (src/app/layout.tsx). The venue's screens: Bodoni Moda for the wordmark and headings, Figtree for
// everything else. The product pages (the sign-in and device pages, Costì plan CB7): Montserrat for headings and Inter for the rest.
// next/font may rename a family, so match loosely. The latin-ext faces (bodoniModaExt, figtreeExt) are excluded: only the main faces
// may satisfy the check.
const VENUE_FAMILIES = [/Bodoni.?Moda(?!Ext)/i, /Figtree(?!Ext)/i];
const PRODUCT_FAMILIES = [/Montserrat/i, /Inter/i];
const firstFamily = (stack: string) => stack.split(",")[0]!.trim();

test("the login page loads its product fonts from the app itself, never from Google", async ({
  page,
}) => {
  const requested: string[] = [];
  const fontResponses: { url: string; status: number }[] = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("response", (response) => {
    if (/\.woff2(\?|$)/.test(response.url()))
      fontResponses.push({ url: response.url(), status: response.status() });
  });

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
  // Every font file the page asked for arrived.
  expect(fontResponses.map((response) => response.url).sort()).toEqual([...fontRequests].sort());
  for (const response of fontResponses) expect(response.status, response.url).toBe(200);

  // Each product family has a face the browser actually loaded (not just declared).
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family),
  );
  for (const family of PRODUCT_FAMILIES)
    expect(
      loaded.some((name) => family.test(name)),
      `${family} in ${loaded.join(", ")}`,
    ).toBe(true);

  // And they are the faces applied: the FIRST family of the stack is Montserrat on the heading and Inter on the body text.
  const heading = page.getByRole("heading", { name: "Accedi" });
  expect(firstFamily(await heading.evaluate((el) => getComputedStyle(el).fontFamily))).toMatch(
    PRODUCT_FAMILIES[0]!,
  );
  expect(
    firstFamily(await page.evaluate(() => getComputedStyle(document.body).fontFamily)),
  ).toMatch(PRODUCT_FAMILIES[1]!);
});

// The venue keeps Bodoni Moda and Figtree: a missing address (a 404 under the static policy, ADR-028) is a venue page. Each family still
// has a face the browser loaded, and Figtree is the face applied to the body.
test("the venue's 404 page loads Bodoni Moda and Figtree from the app itself, never from Google", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  const response = await page.goto("/missing.png");
  expect(response?.status()).toBe(404);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");

  expect(requested.filter((url) => GOOGLE_FONT_HOSTS.test(url))).toEqual([]);
  for (const url of requested.filter((u) => /\.woff2(\?|$)/.test(u))) {
    expect(new URL(url).pathname).toMatch(/^\/_next\/static\/media\//);
  }
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family),
  );
  for (const family of VENUE_FAMILIES)
    expect(
      loaded.some((name) => family.test(name)),
      `${family} in ${loaded.join(", ")}`,
    ).toBe(true);
  // The whole stack, as before: the venue's stack lists the latin-ext face first, so its first family is the Ext face.
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(
    VENUE_FAMILIES[1]!,
  );
});
