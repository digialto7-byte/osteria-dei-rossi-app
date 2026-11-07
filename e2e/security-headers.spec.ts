import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { checkHeaders } from "../src/lib/security/header-check";
import { nonceFromCsp } from "../src/lib/security/nonce";
import { collectCspViolations, scriptTags } from "./helpers/csp";
import { serviceWorkerReady } from "./helpers/offline";
import { newContext } from "./helpers/order-ui";
import { admin, seedApprovableInvoice, tenantIdOf } from "./helpers/seed-invoice";
import { createWaiter, WAITER_A } from "./helpers/seed-menu-tables";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

// M25 step 4 (ADR-028, AT2 on a local server): the headers, the per-request nonce Next.js really uses, the absence of
// CSP violations on the main screens, and the build's pre-render list. Projects `phone` (Chromium) and `phone-webkit`. Fake data
// only. The signed-out checks need no database; the signed-in ones need the local Supabase stack.

const CSP = "content-security-policy";

/** The response's headers as a `Headers`: a repeated header is joined with ", ", exactly as the header check expects. */
function headersOf(response: APIResponse): Headers {
  const headers = new Headers();
  for (const { name, value } of response.headersArray()) headers.append(name, value);
  return headers;
}

/** Opens `path` and proves that the one nonce in its policy is the one on every script, in the HTML and in the page. */
async function expectOneNonceEverywhere(page: Page, path: string): Promise<string> {
  const response = (await page.goto(path))!;
  expect(new URL(page.url()).pathname, `${path} was not redirected`).toBe(path);
  const policies = (await response.headersArray()).filter((h) => h.name.toLowerCase() === CSP);
  expect(policies, `${path} sends exactly one CSP`).toHaveLength(1);
  const nonce = nonceFromCsp(policies[0]!.value);
  expect(nonce, `${path} has a nonce in script-src`).not.toBeNull();
  const tags = scriptTags(await response.text());
  expect(tags.length, `${path} has script tags`).toBeGreaterThan(0);
  for (const tag of tags)
    expect(tag, `${path}: every <script> carries the nonce`).toContain(`nonce="${nonce}"`);
  const mismatched = await page.evaluate(
    (expected) =>
      Array.from(document.scripts)
        .filter((script) => script.nonce !== expected)
        .map((script) => script.src || "inline"),
    nonce!,
  );
  expect(mismatched, `${path}: every document.scripts[i].nonce is the policy's`).toEqual([]);
  return nonce!;
}

test.describe("headers on the local server (AT2)", () => {
  test("checkHeaders finds nothing on /login (twice), /api/health and /sw.js", async ({
    request,
  }) => {
    const [loginA, loginB, health, worker] = [
      await request.get("/login"),
      await request.get("/login"),
      await request.get("/api/health"),
      await request.get("/sw.js"),
    ];
    const { findings } = checkHeaders(
      {
        "/login": [headersOf(loginA), headersOf(loginB)],
        "/api/health": headersOf(health),
        "/sw.js": headersOf(worker),
      },
      "local",
    );
    expect(findings).toEqual([]);
  });

  test("/login: the nonce is the one on every script, and it changes on every load", async ({
    page,
  }) => {
    const first = await expectOneNonceEverywhere(page, "/login");
    const second = await expectOneNonceEverywhere(page, "/login");
    expect(second).not.toBe(first);
  });

  test("non-pages carry one static policy with no nonce; a chunk carries the same static one", async ({
    page,
    request,
  }) => {
    for (const path of ["/api/health", "/sw.js", "/manifest.webmanifest"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const policies = response.headersArray().filter((h) => h.name.toLowerCase() === CSP);
      expect(policies, `${path} sends exactly one CSP`).toHaveLength(1);
      expect(policies[0]!.value, path).not.toContain("'nonce-");
      expect(policies[0]!.value, path).toContain("script-src 'self';");
      if (path === "/api/health") expect(response.headers()["x-nonce"]).toBeUndefined();
    }

    await page.goto("/login");
    const chunks = await page.evaluate(() =>
      Array.from(document.scripts)
        .map((script) => script.src)
        .filter((src) => src.includes("/_next/static/")),
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const response = await request.get(chunk);
      expect(response.status(), chunk).toBe(200);
      // The proxy skips /_next/static, so next.config.ts gives chunks the static policy (ADR-028 decision 3): one, no nonce.
      const policies = response.headersArray().filter((h) => h.name.toLowerCase() === CSP);
      expect(policies, `${chunk} sends exactly one CSP`).toHaveLength(1);
      expect(policies[0]!.value, chunk).not.toContain("'nonce-");
    }
  });

  // The proxy skips image-like paths. A missing one renders not-found through the root layout with no x-nonce: it must be
  // a clean 404 under the static policy (no 500, no missing policy). With no nonce in script-src and no 'unsafe-inline',
  // the browser blocks every inline script of that page.
  for (const path of ["/missing.png", "/nope/missing.svg"]) {
    test(`a missing ${path} is a 404 with one static policy that blocks every inline script`, async ({
      request,
    }) => {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      const policies = response.headersArray().filter((h) => h.name.toLowerCase() === CSP);
      expect(policies, `${path} sends exactly one CSP`).toHaveLength(1);
      const policy = policies[0]!.value;
      const scriptSrc = policy
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("script-src "));
      expect(scriptSrc, `${path} has a script-src`).toBeDefined();
      expect(scriptSrc, path).not.toContain("'unsafe-inline'");
      expect(scriptSrc, path).not.toContain("'nonce-");
      expect(nonceFromCsp(policy), path).toBeNull();
    });
  }
});

// T2 (plan §6), as the build really is: besides the manifest, Next.js 16 pre-renders `/_global-error`, its static fallback
// for a server error. It is not an app page and no navigation reaches it; its scripts carry no nonce, so under a nonce policy
// the browser blocks them and the error page shows without scripts (it fails closed). The list stays exact: any other entry is
// a stop for the architect, never a silent edit (plan §3.1.1). `src/app/global-error.tsx` is useful with no JavaScript: a
// static Italian message, a plain link home and a reload hint (tests/app/global-error.test.ts).
// Pinned to the CI (Turbopack) build; if CI differs, the CI list wins.
const PRERENDERED = ["/_global-error", "/manifest.webmanifest"];

test.describe("the build pre-renders only the manifest and Next's error fallback (T2)", () => {
  test("the keys of routes in .next/prerender-manifest.json are exactly the expected two", () => {
    const next = join(process.cwd(), ".next");
    // Only a production build (`npm run build`) has a BUILD_ID; CI always builds before it tests.
    if (!process.env.CI) test.skip(!existsSync(join(next, "BUILD_ID")), "needs `npm run build`");
    const manifest = JSON.parse(readFileSync(join(next, "prerender-manifest.json"), "utf8")) as {
      routes: Record<string, unknown>;
    };
    expect(Object.keys(manifest.routes).sort()).toEqual(PRERENDERED);
  });
});

test.describe("signed in: one nonce per page, and no CSP violation", () => {
  requireSupabaseStack();
  test.setTimeout(240_000);

  test("the owner's / and /tavoli carry the nonce of their own render", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    const home = await expectOneNonceEverywhere(page, "/");
    const tables = await expectOneNonceEverywhere(page, "/tavoli");
    expect(tables).not.toBe(home);
  });

  test("no violation on the owner's screens, a client-side navigation and the invoice document; page requests recorded", async ({
    page,
  }, testInfo) => {
    const csp = await collectCspViolations(page.context());
    await signInWithMagicLink(page, createOwner());
    const main = page.locator("main");

    await page.goto("/fatture");
    await expect(main.getByRole("heading", { name: "Fatture", exact: true })).toBeVisible();
    await page.goto("/report");
    await expect(main.getByRole("heading", { name: "Report", exact: true })).toBeVisible();

    // Page renders seen while the owner opens Home, waits 5 s and taps one navigation link (recorded for step 21, not asserted).
    const seen = { documents: 0, rsc: 0, prefetch: 0 };
    page.on("request", (request) => {
      const headers = request.headers();
      if (request.resourceType() === "document") seen.documents += 1;
      if (headers["rsc"] === "1") seen.rsc += 1;
      if (headers["next-router-prefetch"] === "1") seen.prefetch += 1;
    });
    await page.goto("/");
    await expect(page.getByTestId("role")).toHaveText("Ruolo: Titolare");
    await page.waitForTimeout(5_000);
    await page
      .getByRole("navigation", { name: "Sezioni" })
      .getByRole("link", { name: "Gestione", exact: true })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === "/fatture");
    await expect(main.getByRole("heading", { name: "Fatture", exact: true })).toBeVisible();
    await testInfo.attach("page-requests.json", {
      body: JSON.stringify(seen, null, 2),
      contentType: "application/json",
    });

    // The invoice document is framed from the Storage origin, at laptop size (the phone gets a button instead).
    const tenantId = await tenantIdOf(page);
    const { invoiceId } = await seedApprovableInvoice(admin(), tenantId, { withFile: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
    // What the browser asked of the Storage origin from inside a frame. `frame-src` allows or blocks that request, so it is what is
    // checked. The frame's own URL (`frame.url()`) is not: a headless browser may hand a PDF to the download handler instead of
    // drawing it, and then the frame never commits (CI run 42387206662: the iframe was visible, no frame URL started with the origin).
    const framed: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith(origin) && request.frame() !== page.mainFrame()) {
        framed.push(`${request.resourceType()} ${new URL(request.url()).pathname}`);
      }
    });
    await page.goto(`/fatture/${invoiceId}/revisione`);
    const frame = page.locator("iframe");
    await expect(frame).toBeVisible();
    const src = (await frame.getAttribute("src")) ?? "";
    expect(
      src.startsWith(`${origin}/storage/v1/object/sign/invoices/`),
      "the frame's address is a signed Storage link",
    ).toBe(true);
    try {
      await expect
        .poll(() => framed.some((entry) => entry.startsWith("document ")), {
          message: "the browser asked the Storage origin for the invoice document from the frame",
        })
        .toBe(true);
    } finally {
      // Attached on failure too: what was asked, which frames exist, and what the policy reported.
      await testInfo.attach("invoice-frame.json", {
        body: JSON.stringify(
          {
            src: new URL(src, "http://x").origin,
            framedRequests: framed,
            frameOrigins: page.frames().map((f) => new URL(f.url(), "http://x").origin),
            violations: csp.violations,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    }

    expect(csp.violations).toEqual([]);
  });

  test("no violation on the waiter's tables, with the service worker in control", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const waiter = await newContext(browser, testInfo.project.use);
    const csp = await collectCspViolations(waiter.context);
    await signInWithMagicLink(waiter.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    await waiter.page.goto("/tavoli");
    await waiter.page.waitForLoadState("networkidle");
    await serviceWorkerReady(waiter.page);
    expect(csp.violations).toEqual([]);
    await waiter.context.close();
  });
});
