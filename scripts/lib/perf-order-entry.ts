// AT7's measurement (M18 plan §3.9, step 17): how long do the order-entry actions take, seen from a GitHub runner?
// All I/O is injected, so the unit test drives it with fakes. The run is started by hand, by the founder, from the
// `perf-order-entry` workflow on `main`, against the staging app only. It reports numbers and promises none; it
// never fails on a number. Nothing here prints a key, a password, a cookie, a URL or an e-mail address.

export const PERF_TENANT_NAME = "Osteria Demo Perf";
export const PERF_OWNER_EMAIL = "perf-owner@perf.example.test";
export const PERF_WAITER_EMAIL = "perf-waiter@perf.example.test";
export const PERF_TABLE_NAME = "Tavolo prova (demo)";
export const PERF_ITEM_COUNT = 20;
export const DEFAULT_ITERATIONS = 100;
/** The product's target (PRD NFR). It is printed next to the numbers, never compared with them. */
const TARGET_MS = 300;
/** Stamps are sent this far in the past: well inside the server's 120 s clock tolerance, whatever the runner's clock. */
const STAMP_LAG_MS = 5_000;

const COURSES = ["antipasti", "primi", "secondi", "dolci", "bevande"] as const;

export type Role = "owner" | "waiter";
export type Method = "GET" | "POST" | "PATCH";

export interface Reply {
  status: number;
  json: unknown;
  /** Wall time of the request, in milliseconds. */
  ms: number;
  serverTiming: string | null;
}

/** What the secret key does (creating the fake accounts, the tenant, the staff row). Nothing is ever read from the database. */
export interface AdminPort {
  findUserId(email: string): Promise<string | null>;
  createUser(email: string, password: string): Promise<string>;
  setPassword(userId: string, password: string): Promise<void>;
  /** create_tenant_with_owner(PERF_TENANT_NAME, ...) for this owner. */
  createTenant(ownerAuthId: string): Promise<void>;
  addWaiter(tenantId: string, authId: string): Promise<void>;
}

export interface PerfPorts {
  admin: AdminPort;
  /** Password sign-in; keeps the session cookies for `request`. The claims (tenant, role) are read at sign-in. */
  signIn(role: Role, email: string, password: string): Promise<void>;
  request(role: Role, method: Method, path: string, body?: unknown): Promise<Reply>;
  newPassword(): string;
  newId(): string;
  /** A monotonic clock, in milliseconds (unused by the arithmetic; reserved for the adapter). */
  nowMs(): number;
  /** The wall clock, for the stamps of the writes. */
  stamp(): Date;
}

/** A failure of the setup that is safe to print: a fixed sentence and an HTTP status, nothing from a reply. */
export class SetupError extends Error {
  constructor(message: string) {
    super(`Setup: ${message}`);
    this.name = "SetupError";
  }
}

// --- arithmetic ------------------------------------------------------------------------------------------------------

/** The value at the nearest rank of the p-th percentile (the sample itself, no interpolation); null for no samples. */
export function nearestRank(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

export interface Summary {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export function summarize(values: readonly number[]): Summary {
  return {
    n: values.length,
    p50: nearestRank(values, 50),
    p95: nearestRank(values, 95),
    max: nearestRank(values, 100),
  };
}

/** `auth;dur=12.5, rpc;dur=40` -> { auth: 12.5, rpc: 40 }. Entries without a numeric duration are ignored. */
export function parseServerTiming(header: string | null): Record<string, number> {
  const parts: Record<string, number> = {};
  if (!header) return parts;
  for (const entry of header.match(/(?:[^,"]|"[^"]*")+/g) ?? []) {
    const name = entry.split(";")[0]!.trim();
    const duration = /;\s*dur=(\d+(?:\.\d+)?)\s*(?:;|$)/.exec(entry);
    if (name && duration) parts[name] = Number(duration[1]);
  }
  return parts;
}

// --- the target guard --------------------------------------------------------------------------------------------------

/**
 * The run may only touch the staging Supabase project and an https app. The messages never carry the URL they refuse.
 * Returns the app's origin (a path or a query in `base_url` is dropped).
 */
export function assertTarget(input: { supabaseUrl: string; baseUrl: string; stagingRef: string }): {
  baseOrigin: string;
} {
  if (!input.stagingRef) throw new Error("STAGING_PROJECT_REF is not set; refusing to run.");
  const refused = new Error("The Supabase URL is not the staging project; refusing to run.");
  let supabase: URL;
  try {
    supabase = new URL(input.supabaseUrl);
  } catch {
    throw refused;
  }
  if (
    supabase.protocol !== "https:" ||
    supabase.username !== "" ||
    supabase.password !== "" ||
    supabase.port !== "" ||
    supabase.hostname !== `${input.stagingRef}.supabase.co`
  ) {
    throw refused;
  }
  const bad = new Error(
    "base_url must be an https:// address without credentials; refusing to run.",
  );
  let app: URL;
  try {
    app = new URL(input.baseUrl);
  } catch {
    throw bad;
  }
  if (app.protocol !== "https:" || app.username !== "" || app.password !== "" || !app.hostname) {
    throw bad;
  }
  return { baseOrigin: app.origin };
}

// --- setup (idempotent) --------------------------------------------------------------------------------------------------

export interface PerfItem {
  id: string;
  name: string;
  course: string;
}

export interface Fixtures {
  tenantId: string;
  sessionId: string;
  items: PerfItem[];
}

const itemName = (index: number) => `Piatto prova ${String(index).padStart(2, "0")} (demo)`;
const isOk = (status: number) => status >= 200 && status < 300;

async function must(
  ports: PerfPorts,
  role: Role,
  method: Method,
  path: string,
  body?: unknown,
  accept: (status: number) => boolean = isOk,
): Promise<Reply> {
  const reply = await ports.request(role, method, path, body);
  if (!accept(reply.status)) {
    throw new SetupError(
      `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")} answered ${reply.status}.`,
    );
  }
  return reply;
}

interface Me {
  user?: { role?: string };
  tenant?: { id?: string; name?: string };
}

/** The account's membership, or null when it has none yet (403). Any other answer stops the setup. */
async function membership(
  ports: PerfPorts,
  role: Role,
): Promise<{ tenantId: string; name: string } | null> {
  const reply = await must(ports, role, "GET", "/api/me", undefined, (s) => s === 200 || s === 403);
  if (reply.status === 403) return null;
  const me = reply.json as Me;
  if (!me.tenant?.id || !me.tenant.name) throw new SetupError("/api/me has no tenant.");
  return { tenantId: me.tenant.id, name: me.tenant.name };
}

function listOf(json: unknown, key: string): { id: string; name: string }[] {
  const list = (json as Record<string, unknown>)[key];
  return Array.isArray(list) ? (list as { id: string; name: string }[]) : [];
}

/**
 * Makes sure the fake tenant "Osteria Demo Perf" exists with an owner, a waiter, twenty dishes with no recipe and one table, and
 * that the table has an open session; returns the ids the run needs. Run twice, it creates nothing the second time.
 * Both accounts get a fresh random password on every run (reset through the secret key); none is stored.
 */
export async function provision(ports: PerfPorts): Promise<Fixtures> {
  const ids = {} as Record<Role, string>;
  const passwords = {} as Record<Role, string>;
  for (const [role, email] of [
    ["owner", PERF_OWNER_EMAIL],
    ["waiter", PERF_WAITER_EMAIL],
  ] as const) {
    passwords[role] = ports.newPassword();
    const existing = await ports.admin.findUserId(email);
    if (existing) {
      await ports.admin.setPassword(existing, passwords[role]);
      ids[role] = existing;
    } else {
      ids[role] = await ports.admin.createUser(email, passwords[role]);
    }
  }

  await ports.signIn("owner", PERF_OWNER_EMAIL, passwords.owner);
  let owner = await membership(ports, "owner");
  if (!owner) {
    await ports.admin.createTenant(ids.owner);
    await ports.signIn("owner", PERF_OWNER_EMAIL, passwords.owner);
    owner = await membership(ports, "owner");
    if (!owner) throw new SetupError("the owner has no tenant after creating it.");
  }
  // Never write into a tenant that is not the fake one.
  if (owner.name !== PERF_TENANT_NAME)
    throw new SetupError("the owner's tenant is not the perf tenant.");

  await ports.signIn("waiter", PERF_WAITER_EMAIL, passwords.waiter);
  let waiter = await membership(ports, "waiter");
  if (!waiter) {
    await ports.admin.addWaiter(owner.tenantId, ids.waiter);
    await ports.signIn("waiter", PERF_WAITER_EMAIL, passwords.waiter);
    waiter = await membership(ports, "waiter");
  }
  if (!waiter || waiter.tenantId !== owner.tenantId) {
    throw new SetupError("the waiter is not in the perf tenant.");
  }

  const have = new Set(
    listOf((await must(ports, "owner", "GET", "/api/menu/items")).json, "items").map((i) => i.name),
  );
  for (let index = 1; index <= PERF_ITEM_COUNT; index += 1) {
    const name = itemName(index);
    if (have.has(name)) continue;
    const course = COURSES[(index - 1) % COURSES.length]!;
    await must(ports, "owner", "POST", "/api/menu/items", {
      name,
      category: course[0]!.toUpperCase() + course.slice(1),
      course,
      recipeKey: null,
      price: 5 + (index % 8),
      vatRate: 10,
    });
  }

  let table = listOf((await must(ports, "owner", "GET", "/api/dining-tables")).json, "tables").find(
    (t) => t.name === PERF_TABLE_NAME,
  );
  if (!table) {
    const made = await must(ports, "owner", "POST", "/api/dining-tables", {
      name: PERF_TABLE_NAME,
    });
    table = (made.json as { table: { id: string; name: string } }).table;
  }

  const open = await must(
    ports,
    "waiter",
    "POST",
    `/api/tables/${table.id}/open`,
    { sessionId: ports.newId(), covers: 2 },
    (s) => isOk(s) || s === 409,
  );
  const body = open.json as {
    session?: { id?: string };
    error?: { details?: { session?: { id?: string } } };
  };
  const sessionId = open.status === 409 ? body.error?.details?.session?.id : body.session?.id;
  if (!sessionId) throw new SetupError("the table session is missing.");

  const names = new Set(Array.from({ length: PERF_ITEM_COUNT }, (_, i) => itemName(i + 1)));
  const menu = (await must(ports, "waiter", "GET", "/api/menu")).json as {
    categories?: { items?: PerfItem[] }[];
  };
  const items = (menu.categories ?? [])
    .flatMap((category) => category.items ?? [])
    .filter((item) => names.has(item.name))
    .map(({ id, name, course }) => ({ id, name, course }));
  if (items.length !== PERF_ITEM_COUNT)
    throw new SetupError("the waiter's menu lacks the perf dishes.");

  return { tenantId: owner.tenantId, sessionId, items };
}

// --- the measurement ------------------------------------------------------------------------------------------------------

export const LABELS = ["add", "edit", "move", "remove", "menu", "lines"] as const;
export type Label = (typeof LABELS)[number];

export interface ActionSamples {
  /** Wall time per request, ms. */
  wall: number[];
  /** Requests answered outside 2xx. */
  errors: number;
  /** Server-Timing durations by name, ms. */
  parts: Record<string, number[]>;
}
export type Samples = Record<Label, ActionSamples>;

/**
 * One iteration per dish in turn, sequential, as the waiter: add a line, change its quantity, move it to the next
 * course, remove it, read the menu, read the order. Failures are counted, never thrown: numbers do not stop a run.
 */
export async function measure(
  ports: PerfPorts,
  fx: Fixtures,
  iterations: number,
): Promise<Samples> {
  const samples = {} as Samples;
  for (const label of LABELS) samples[label] = { wall: [], errors: 0, parts: {} };
  let last = ports.stamp().getTime() - STAMP_LAG_MS;
  const stamp = () => new Date(++last).toISOString();
  const take = async (label: Label, method: Method, path: string, body?: unknown) => {
    const reply = await ports.request("waiter", method, path, body);
    const into = samples[label];
    into.wall.push(reply.ms);
    if (!isOk(reply.status)) into.errors += 1;
    for (const [name, duration] of Object.entries(parseServerTiming(reply.serverTiming))) {
      (into.parts[name] ??= []).push(duration);
    }
  };

  for (let index = 0; index < iterations; index += 1) {
    const item = fx.items[index % fx.items.length]!;
    const lineId = ports.newId();
    const other =
      COURSES[(COURSES.indexOf(item.course as (typeof COURSES)[number]) + 1) % COURSES.length]!;
    await take("add", "POST", `/api/table-sessions/${fx.sessionId}/lines`, {
      lineId,
      menuItemId: item.id,
      course: item.course,
      clientUpdatedAt: stamp(),
    });
    await take("edit", "PATCH", `/api/order-lines/${lineId}`, { qty: 2, clientUpdatedAt: stamp() });
    await take("move", "PATCH", `/api/order-lines/${lineId}`, {
      course: other,
      clientUpdatedAt: stamp(),
    });
    await take("remove", "POST", `/api/order-lines/${lineId}/remove`, { clientUpdatedAt: stamp() });
    await take("menu", "GET", "/api/menu");
    await take("lines", "GET", `/api/table-sessions/${fx.sessionId}/lines`);
  }
  return samples;
}

// --- the report ------------------------------------------------------------------------------------------------------------

const ms = (value: number | null) => (value === null ? "–" : value.toFixed(1));
const pair = (values: readonly number[] | undefined) =>
  values && values.length > 0
    ? `${ms(nearestRank(values, 50))} / ${ms(nearestRank(values, 95))}`
    : "–";

/** Markdown for the job summary: fixed words and numbers only. */
export function renderReport(
  samples: Partial<Record<string, ActionSamples>>,
  meta: { iterations: number; itemCount: number },
): string {
  const rows = Object.entries(samples).map(([label, s]) => {
    const wall = summarize(s!.wall);
    return `| ${label} | ${wall.n} | ${s!.errors} | ${ms(wall.p50)} | ${ms(wall.p95)} | ${ms(wall.max)} | ${pair(s!.parts.auth)} | ${pair(s!.parts.rpc)} | ${pair(s!.parts.total)} |`;
  });
  return [
    "## AT7 · Velocità della comanda",
    "",
    `Misurato da un runner GitHub, non da un telefono in 4G. Nessun valore è una promessa: l'obiettivo del prodotto è ${TARGET_MS} ms.`,
    "",
    `- Dati: tenant "${PERF_TENANT_NAME}", ${meta.itemCount} piatti senza ricetta, 1 tavolo.`,
    `- Prova: ${meta.iterations} iterazioni, una richiesta alla volta: aggiunta, modifica, spostamento, rimozione, lettura del menu, lettura della comanda.`,
    "- Non incluso: il cameriere di prova non accede con il PIN ma con le credenziali dell'email, quindi manca la verifica di sessione PIN (una chiamata in più per richiesta); nessun piatto è legato a un lotto, quindi manca il controllo delle scorte.",
    '- Tempi in millisecondi. "auth", "rpc" e "totale server" vengono dall\'intestazione Server-Timing (p50 / p95).',
    "",
    "| Azione | n | Errori | p50 ms | p95 ms | max ms | auth | rpc | totale server |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

// --- the whole run ----------------------------------------------------------------------------------------------------------

/**
 * Setup, measure, report. Returns the process exit code: 0 whatever the numbers are; 1 only when the setup cannot be done
 * (nothing is printed to `write` then, and the message is a fixed sentence with at most an HTTP status).
 */
export async function run(
  ports: PerfPorts,
  options: {
    iterations: number;
    write: (text: string) => void;
    writeError?: (text: string) => void;
  },
): Promise<number> {
  try {
    const fixtures = await provision(ports);
    const samples = await measure(ports, fixtures, options.iterations);
    options.write(
      renderReport(samples, { iterations: options.iterations, itemCount: fixtures.items.length }),
    );
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
