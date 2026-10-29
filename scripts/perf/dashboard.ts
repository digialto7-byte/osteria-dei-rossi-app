// AT10 (owner dashboard plan §5 step 15): times GET /api/dashboard on the LOCAL stack, as the owner of the demo tenant that
// `npm run demo` creates, and prints a Markdown report of numbers (p50, p95, max) for the PR. It refuses any target that is not
// on this machine, never fails on a number and promises none. It is not a phone on 4G.
//   npm run perf:dashboard -- [--base-url http://127.0.0.1:3000] [--iterations 100]
// Needs the local stack (`npx supabase start`), the app running (`npm run start`), `npm run demo` once, and the local
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY. The secret key is used here only
// (scripts/ is the allowed place) to give the fake demo owner a password for the run.
import { parseArgs } from "node:util";
import { createServerClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_ITERATIONS,
  runGuarded,
  type DashboardPorts,
  type Reply,
} from "../lib/perf-dashboard";

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
  return { baseUrl: values["base-url"] ?? "http://127.0.0.1:3000", iterations };
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
  header() {
    return this.getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
}

function realPorts(input: {
  supabaseUrl: string;
  publishableKey: string;
  baseOrigin: string;
}): DashboardPorts {
  const jar = new Jar();
  const admin = createSupabaseAdminClient();
  return {
    admin: {
      findUserId: async (email) => {
        for (let page = 1; ; page += 1) {
          const { data, error } = await admin.auth.admin.listUsers({
            page,
            perPage: USERS_PER_PAGE,
          });
          if (error) throw new Error("listing users failed");
          const found = data.users.find((user) => user.email === email);
          if (found) return found.id;
          if (data.users.length < USERS_PER_PAGE) return null;
        }
      },
      setPassword: async (userId, password) => {
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) throw new Error("setting a password failed");
      },
    },
    signIn: async (email, password) => {
      const client = createServerClient(input.supabaseUrl, input.publishableKey, {
        cookieOptions: SESSION_COOKIE_OPTIONS,
        cookies: { getAll: () => jar.getAll(), setAll: (items) => jar.setAll(items) },
      });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error("signing in failed");
    },
    request: async (path): Promise<Reply> => {
      const started = performance.now();
      const response = await fetch(`${input.baseOrigin}${path}`, {
        headers: { accept: "application/json", cookie: jar.header() },
      });
      const text = await response.text();
      const ms = performance.now() - started;
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        // A non-JSON answer is a non-2xx for the report; its text is never kept.
      }
      return {
        status: response.status,
        json,
        ms,
        serverTiming: response.headers.get("server-timing"),
      };
    },
    newPassword: () => randomBytes(32).toString("base64url"),
  };
}

const env = readPublicEnv();
const args = readArgs();

process.exitCode = await runGuarded({
  supabaseUrl: env.supabaseUrl,
  baseUrl: args.baseUrl,
  makePorts: (baseOrigin) =>
    realPorts({
      supabaseUrl: env.supabaseUrl,
      publishableKey: env.supabasePublishableKey,
      baseOrigin,
    }),
  iterations: args.iterations,
  write: (text) => process.stdout.write(`${text}\n`),
  writeError: (text) => console.error(text),
});
