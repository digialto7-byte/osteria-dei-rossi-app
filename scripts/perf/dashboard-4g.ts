// AT7 (M22 plan §5 step 18): times the owner dashboard's "Ieri" tile on a simulated Slow 4G connection (Chromium, from a GitHub
// runner) against the STAGING app and prints a Markdown report of numbers (p50, p95, max). Started by hand by the founder through
// .github/workflows/perf-dashboard-4g.yml on `main`; nobody else runs it. It signs in the fake perf owner that the order-entry
// timing run created (it writes nothing else), and refuses any other project or app host. It never fails on a number.
//   npx tsx scripts/perf/dashboard-4g.ts --base-url https://<staging app>
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, STAGING_PROJECT_REF, STAGING_APP_HOST
// and PERF_STAGING_OK=yes. The secret key is used here only (scripts/ is the allowed place) to give the fake owner a password.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { chromium, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import {
  SLOW_4G,
  addBypassRoute,
  assertStagingTarget,
  run,
  type Perf4gPorts,
} from "../lib/perf-4g";
import { bypassHeaders } from "../lib/perf-bypass";
import { PERF_OWNER_EMAIL, SetupError } from "../lib/perf-order-entry";

const USERS_PER_PAGE = 200;
const TILE_TIMEOUT_MS = 30_000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** One in-memory browser: the Supabase session cookies of the signed-in owner. */
class Jar {
  private readonly cookies = new Map<string, string>();
  getAll() {
    return [...this.cookies].map(([name, value]) => ({ name, value }));
  }
  setAll(items: { name: string; value: string; options?: { maxAge?: number } }[]) {
    for (const { name, value, options } of items) {
      if (value === "" || options?.maxAge === 0) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

async function findUserId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<string | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw new Error("listing users failed");
    const found = data.users.find((user) => user.email === email);
    if (found) return found.id;
    if (data.users.length < USERS_PER_PAGE) return null;
  }
}

async function main(): Promise<number> {
  if (process.env.PERF_STAGING_OK !== "yes") {
    fail(
      "Refusing to run: this script is for the staging run started by the founder (PERF_STAGING_OK=yes).",
    );
  }
  const env = readPublicEnv();
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { "base-url": { type: "string" } },
  });
  let baseOrigin: string;
  try {
    ({ baseOrigin } = assertStagingTarget({
      supabaseUrl: env.supabaseUrl,
      baseUrl: values["base-url"] ?? "",
      stagingRef: process.env.STAGING_PROJECT_REF ?? "",
      stagingAppHost: process.env.STAGING_APP_HOST ?? "",
    }));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Refusing to run.");
  }

  const jar = new Jar();
  const browser = await chromium.launch();
  let warmContext: BrowserContext | null = null;

  const newContext = async () => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      isMobile: true,
    });
    // Vercel Authentication on the staging host: the bypass header is added to requests to the app origin only (not Supabase).
    await addBypassRoute(context, baseOrigin, process.env);
    await context.addCookies(
      jar.getAll().map(({ name, value }) => ({ name, value, url: baseOrigin })),
    );
    return context;
  };

  /** One navigation to Oggi in `context`, throttled; ms until the tile shows, null if it never did. */
  const timeOnce = async (context: BrowserContext): Promise<number | null> => {
    const page = await context.newPage();
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...SLOW_4G });
      const started = performance.now();
      await page.goto(`${baseOrigin}/`, { waitUntil: "commit" });
      try {
        await page
          .locator('main [data-tile="yesterday"]')
          .waitFor({ state: "visible", timeout: TILE_TIMEOUT_MS });
      } catch {
        return null;
      }
      return performance.now() - started;
    } finally {
      await page.close();
    }
  };

  const ports: Perf4gPorts = {
    provisionOwner: async () => {
      const admin = createSupabaseAdminClient();
      const userId = await findUserId(admin, PERF_OWNER_EMAIL);
      if (!userId) {
        throw new SetupError("the perf owner does not exist; run the order-entry timing first.");
      }
      const password = randomBytes(32).toString("base64url");
      const updated = await admin.auth.admin.updateUserById(userId, { password });
      if (updated.error) throw new SetupError("setting the perf owner's password failed.");
      const client = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
        cookieOptions: SESSION_COOKIE_OPTIONS,
        cookies: { getAll: () => jar.getAll(), setAll: (items) => jar.setAll(items) },
      });
      const signedIn = await client.auth.signInWithPassword({ email: PERF_OWNER_EMAIL, password });
      if (signedIn.error) throw new SetupError("signing in the perf owner failed.");
      const context = await newContext();
      try {
        const me = await context.request.get(`${baseOrigin}/api/me`, {
          headers: bypassHeaders(process.env),
        });
        if (me.status() !== 200) throw new SetupError(`GET /api/me answered ${me.status()}.`);
        const body = (await me.json()) as { user?: { role?: string } };
        if (body.user?.role !== "owner")
          throw new SetupError("the signed-in user is not an owner.");
      } finally {
        await context.close();
      }
    },
    load: async (mode) => {
      if (mode === "cold") {
        const context = await newContext();
        try {
          return await timeOnce(context);
        } finally {
          await context.close();
        }
      }
      if (!warmContext) {
        warmContext = await newContext();
        await timeOnce(warmContext); // primes the cache; not counted
      }
      return timeOnce(warmContext);
    },
  };

  try {
    return await run(ports, {
      write: (text) => process.stdout.write(`${text}\n`),
      writeError: (text) => console.error(text),
    });
  } finally {
    await browser.close();
  }
}

process.exitCode = await main();
