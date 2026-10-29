// The server-side speed of GET /api/dashboard (owner dashboard plan §5 step 15, AT10): 100 sequential requests as the owner of
// the demo tenant that `npm run demo` creates on the LOCAL stack, then p50, p95 and max of the wall time and of the parts of the
// Server-Timing header. All I/O is injected, so the unit test drives it with fakes. It reports numbers and promises none; it
// never fails on a number. It is not a phone on 4G, and the report says so. Nothing here prints a key, a password, a cookie, a
// URL or an e-mail address. Staging is a separate decision (variant V5) and is refused here.
import {
  SetupError,
  nearestRank,
  parseServerTiming,
  summarize,
  type Reply,
} from "./perf-order-entry";

export type { Reply };

export const DEFAULT_ITERATIONS = 100;
/** The product's target (PRD NFR: dashboard under 2 s on a phone over 4G). Printed next to the numbers, never compared. */
const TARGET_MS = 2000;

export const LOCAL_ONLY_SENTENCE =
  "Refusing to run: this measurement is for the local stack only (Supabase and the app on 127.0.0.1 or localhost).";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

function localUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const ok =
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOCAL_HOSTS.has(url.hostname) &&
    url.username === "" &&
    url.password === "";
  return ok ? url : null;
}

/**
 * Both the Supabase URL and the app URL must be on this machine (127.0.0.1 or localhost, no credentials). The message repeats
 * nothing it was given. Returns the app's origin (a path or a query in `baseUrl` is dropped).
 */
export function assertLocalTarget(input: { supabaseUrl: string; baseUrl: string }): {
  baseOrigin: string;
} {
  const supabase = localUrl(input.supabaseUrl);
  const app = localUrl(input.baseUrl);
  if (!supabase || !app) throw new Error(LOCAL_ONLY_SENTENCE);
  return { baseOrigin: app.origin };
}

// --- ports -------------------------------------------------------------------------------------------------------------------

/** What the secret key does here: find the demo owner and give it a password for this run. Nothing is read from the database. */
export interface DashboardAdminPort {
  findUserId(email: string): Promise<string | null>;
  setPassword(userId: string, password: string): Promise<void>;
}

export interface DashboardPorts {
  admin: DashboardAdminPort;
  /** Password sign-in of the demo owner; keeps the session cookies for `request`. */
  signIn(email: string, password: string): Promise<void>;
  request(path: string): Promise<Reply>;
  newPassword(): string;
}

interface Me {
  user?: { role?: string };
  tenant?: { id?: string; isDemo?: boolean };
}

/**
 * The demo owner gets a fresh random password (reset through the secret key, never stored), signs in, and is checked: an owner
 * of a demo tenant. The run never measures a tenant that is not marked as demo data.
 */
export async function provisionOwner(
  ports: DashboardPorts,
  email = DEMO_OWNER_EMAIL,
): Promise<void> {
  const userId = await ports.admin.findUserId(email);
  if (!userId) throw new SetupError("the demo owner does not exist; run `npm run demo` first.");
  const password = ports.newPassword();
  await ports.admin.setPassword(userId, password);
  await ports.signIn(email, password);
  const reply = await ports.request("/api/me");
  if (reply.status !== 200) throw new SetupError(`GET /api/me answered ${reply.status}.`);
  const me = reply.json as Me | null;
  if (me?.user?.role !== "owner") throw new SetupError("the signed-in user is not an owner.");
  if (!me.tenant?.id || me.tenant.isDemo !== true) {
    throw new SetupError("the owner's tenant is not a demo tenant; refusing to measure it.");
  }
}

/** The demo owner of the local stack (scripts/lib/demo/fixture.ts). It is an address on example.test, never printed. */
export const DEMO_OWNER_EMAIL = "titolare.demo@example.test";

// --- the measurement ---------------------------------------------------------------------------------------------------------

export interface DashboardSamples {
  /** Wall time per request, ms. */
  wall: number[];
  /** Requests answered outside 2xx. */
  errors: number;
  /** Server-Timing durations by name, ms. */
  parts: Record<string, number[]>;
}

/** `iterations` sequential reads. Failures are counted, never thrown: numbers do not stop a run. */
export async function measure(
  ports: DashboardPorts,
  iterations: number,
): Promise<DashboardSamples> {
  const samples: DashboardSamples = { wall: [], errors: 0, parts: {} };
  for (let index = 0; index < iterations; index += 1) {
    const reply = await ports.request("/api/dashboard");
    samples.wall.push(reply.ms);
    if (reply.status < 200 || reply.status >= 300) samples.errors += 1;
    for (const [name, duration] of Object.entries(parseServerTiming(reply.serverTiming))) {
      (samples.parts[name] ??= []).push(duration);
    }
  }
  return samples;
}

// --- the report --------------------------------------------------------------------------------------------------------------

const ms = (value: number | null) => (value === null ? "–" : value.toFixed(1));
const pair = (values: readonly number[] | undefined) =>
  values && values.length > 0
    ? `${ms(nearestRank(values, 50))} / ${ms(nearestRank(values, 95))}`
    : "– / –";

/** Markdown for the PR: fixed words and numbers only. */
export function renderReport(samples: DashboardSamples, meta: { iterations: number }): string {
  const wall = summarize(samples.wall);
  return [
    "## AT10 · Velocità del cruscotto (lato server)",
    "",
    `Misurato in locale sui dati di prova, non da un telefono in 4G. Nessun valore è una promessa: l'obiettivo del prodotto è ${TARGET_MS / 1000} s su un telefono in 4G, e si verifica a parte.`,
    "",
    `- Prova: ${meta.iterations} richieste GET /api/dashboard, una alla volta, come titolare del locale di prova creato da \`npm run demo\`.`,
    '- Tempi in millisecondi. "auth", "rpc" e "totale server" vengono dall\'intestazione Server-Timing (p50 / p95).',
    "",
    "| Richiesta | n | Errori | p50 ms | p95 ms | max ms | auth | rpc | totale server |",
    "|---|---|---|---|---|---|---|---|---|",
    `| GET /api/dashboard | ${wall.n} | ${samples.errors} | ${ms(wall.p50)} | ${ms(wall.p95)} | ${ms(wall.max)} | ${pair(samples.parts.auth)} | ${pair(samples.parts.rpc)} | ${pair(samples.parts.total)} |`,
    "",
  ].join("\n");
}

// --- the whole run -----------------------------------------------------------------------------------------------------------

export interface RunOptions {
  iterations: number;
  write: (text: string) => void;
  writeError?: (text: string) => void;
}

/**
 * Setup, measure, report. Returns the process exit code: 0 whatever the numbers are; 1 only when the setup cannot be done
 * (nothing is printed to `write` then, and the message is a fixed sentence with at most an HTTP status).
 */
export async function run(ports: DashboardPorts, options: RunOptions): Promise<number> {
  try {
    await provisionOwner(ports);
    const samples = await measure(ports, options.iterations);
    options.write(renderReport(samples, { iterations: options.iterations }));
    return 0;
  } catch (error) {
    options.writeError?.(
      error instanceof SetupError
        ? error.message
        : "Setup: unexpected error before the measurement.",
    );
    return 1;
  }
}

/** The guard first: a refused target builds no ports, so no request and no client is ever made. */
export async function runGuarded(
  input: RunOptions & {
    supabaseUrl: string;
    baseUrl: string;
    makePorts: (baseOrigin: string) => DashboardPorts;
  },
): Promise<number> {
  let baseOrigin: string;
  try {
    ({ baseOrigin } = assertLocalTarget({
      supabaseUrl: input.supabaseUrl,
      baseUrl: input.baseUrl,
    }));
  } catch (error) {
    input.writeError?.(error instanceof Error ? error.message : LOCAL_ONLY_SENTENCE);
    return 1;
  }
  return run(input.makePorts(baseOrigin), input);
}
