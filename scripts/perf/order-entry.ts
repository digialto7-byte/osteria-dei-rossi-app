// AT7 (M18 plan §3.9): times the order-entry actions against the STAGING app from a GitHub runner and prints a Markdown
// report of numbers (p50, p95, max). Started by hand by the founder through .github/workflows/perf-order-entry.yml on
// `main`; nobody else runs it. It writes fake data only, into the fake tenant "Osteria Demo Perf" of the staging
// project, and refuses any other project. It never fails on a number and promises none.
//   npx tsx scripts/perf/order-entry.ts --base-url https://<staging app> [--iterations 100]
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, STAGING_PROJECT_REF and
// PERF_STAGING_OK=yes. The secret key is used here only (scripts/ is the allowed place) to create the fake accounts.
import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createServerClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import {
  DEFAULT_ITERATIONS,
  PERF_TENANT_NAME,
  assertTarget,
  run,
  type AdminPort,
  type Method,
  type PerfPorts,
  type Reply,
  type Role,
} from "../lib/perf-order-entry";

const PERF_VAT = "IT00000000042";
const OWNER_NAME = "Titolare Prova Demo";
const WAITER_NAME = "Cameriere Prova Demo";
const USERS_PER_PAGE = 200;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { "base-url": { type: "string" }, iterations: { type: "string" } },
  });
  const iterations =
    values.iterations === undefined ? DEFAULT_ITERATIONS : Number(values.iterations);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) {
    fail("--iterations must be a whole number from 1 to 1000.");
  }
  return { baseUrl: values["base-url"] ?? "", iterations };
}

/** One in-memory browser: the Supabase session cookies of one signed-in account. */
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
  header() {
    return this.getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
}

function adminPort(): AdminPort {
  const admin = createSupabaseAdminClient();
  return {
    findUserId: async (email) => {
      for (let page = 1; ; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
        if (error) throw new Error("listing users failed");
        const found = data.users.find((user) => user.email === email);
        if (found) return found.id;
        if (data.users.length < USERS_PER_PAGE) return null;
      }
    },
    createUser: async (email, password) => {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error("creating a user failed");
      return data.user.id;
    },
    setPassword: async (userId, password) => {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw new Error("setting a password failed");
    },
    createTenant: async (ownerAuthId) => {
      const { error } = await admin.rpc("create_tenant_with_owner", {
        tenant_name: PERF_TENANT_NAME,
        tenant_vat_number: PERF_VAT,
        owner_auth_id: ownerAuthId,
        owner_display_name: OWNER_NAME,
      });
      if (error) throw new Error("creating the tenant failed");
    },
    addWaiter: async (tenantId, authId) => {
      const { error } = await admin.from("app_user").insert({
        tenant_id: tenantId,
        auth_id: authId,
        role: "waiter",
        display_name: WAITER_NAME,
      });
      if (error) throw new Error("adding the waiter failed");
    },
  };
}

function realPorts(input: {
  supabaseUrl: string;
  publishableKey: string;
  baseOrigin: string;
}): PerfPorts {
  const jars: Record<Role, Jar> = { owner: new Jar(), waiter: new Jar() };
  return {
    admin: adminPort(),
    signIn: async (role, email, password) => {
      jars[role] = new Jar();
      const jar = jars[role];
      const client = createServerClient(input.supabaseUrl, input.publishableKey, {
        cookieOptions: SESSION_COOKIE_OPTIONS,
        cookies: { getAll: () => jar.getAll(), setAll: (items) => jar.setAll(items) },
      });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error("signing in failed");
    },
    request: async (role, method: Method, path, body): Promise<Reply> => {
      const started = performance.now();
      const response = await fetch(`${input.baseOrigin}${path}`, {
        method,
        headers: {
          accept: "application/json",
          cookie: jars[role].header(),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const ms = performance.now() - started;
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        // A non-JSON answer (a gateway page) is a non-2xx for the report; its text is never kept.
      }
      return {
        status: response.status,
        json,
        ms,
        serverTiming: response.headers.get("server-timing"),
      };
    },
    newPassword: () => randomBytes(32).toString("base64url"),
    newId: () => randomUUID(),
    nowMs: () => performance.now(),
    stamp: () => new Date(),
  };
}

if (process.env.PERF_STAGING_OK !== "yes") {
  fail(
    "Refusing to run: this script is for the staging run started by the founder (PERF_STAGING_OK=yes).",
  );
}
let target: { baseOrigin: string };
const env = readPublicEnv();
const args = readArgs();
try {
  target = assertTarget({
    supabaseUrl: env.supabaseUrl,
    baseUrl: args.baseUrl,
    stagingRef: process.env.STAGING_PROJECT_REF ?? "",
  });
} catch (error) {
  fail(error instanceof Error ? error.message : "Refusing to run.");
}

process.exitCode = await run(
  realPorts({
    supabaseUrl: env.supabaseUrl,
    publishableKey: env.supabasePublishableKey,
    baseOrigin: target.baseOrigin,
  }),
  {
    iterations: args.iterations,
    write: (text) => process.stdout.write(`${text}\n`),
    writeError: (text) => console.error(text),
  },
);
