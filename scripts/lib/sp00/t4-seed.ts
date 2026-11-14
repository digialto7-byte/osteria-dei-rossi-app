// SP0 spike (§3.5, §3.7, S12): fills the measured tenant "Osteria Demo SP0" for T4. The tenant and its owner come from `createTenant`, the data
// from the existing demo seed (`runSeed`, with the spike's clients), and one open table with one fired course from the waiter's own token (no
// secret key), so that `kitchen_tickets` is not empty. All I/O is injected. The result holds ids, counts and step names; never an address.
import { OWNER_LOCAL_EMAIL } from "../demo/fixture";
import type { SeedOutcome } from "../demo/seed";
import type { CreateTenantInput } from "../create-tenant";
import { errorName, type AuthResult } from "./common";
import { assertClean, type CaseReport } from "./report";
import type { RestAnswer } from "./t2";

export interface T4SeedDeps {
  createTenant(input: CreateTenantInput): Promise<string>;
  /** The demo seed for an existing tenant, driven with the spike's admin client. */
  runSeed(tenantId: string): Promise<SeedOutcome>;
  /** Admin: a user with an `app_user` row of this role in the tenant (a waiter as scripts/lib/perf-order-entry.ts does; a chef for the kitchen mark). */
  createStaff(
    tenantId: string,
    role: "waiter" | "chef",
  ): Promise<{ email: string; password: string }>;
  staffSignIn(email: string, password: string): Promise<AuthResult>;
  /** A PostgREST call with the waiter's or the chef's token. `path` is relative to `/rest/v1`. */
  rest(
    accessToken: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<RestAnswer>;
  newId(): string;
  /** An ISO instant for `clientUpdatedAt`. */
  stamp(): string;
}

export interface T4SeedResult {
  ok: boolean;
  error?: string;
  tenantId: string | null;
  counts: Record<string, number>;
  steps: { id: string; ok: boolean }[];
}

const failed = (
  error: string,
  tenantId: string | null,
  counts: Record<string, number>,
  steps: T4SeedResult["steps"],
): T4SeedResult => ({
  ok: false,
  error,
  tenantId,
  counts,
  steps,
});

export async function runT4Seed(
  deps: T4SeedDeps,
  target: "local" | "temp",
  preflight: CaseReport | null,
): Promise<T4SeedResult> {
  if (target === "temp" && preflight === null) {
    throw new Error("The T4 seed on the temporary project needs the preflight result first.");
  }
  if (preflight !== null && preflight.result !== "pass")
    return failed("preflight failed", null, {}, []);

  const steps: T4SeedResult["steps"] = [];
  const done = (id: string) => steps.push({ id, ok: true });

  let tenantId: string;
  try {
    tenantId = await deps.createTenant({
      name: "Osteria Demo SP0",
      vatNumber: "IT00000000000",
      ownerEmail: OWNER_LOCAL_EMAIL,
      ownerName: "Titolare Demo",
    });
  } catch (error) {
    return failed(`create tenant failed (${errorName(error)})`, null, {}, steps);
  }
  done("tenant");

  const seeded = await deps.runSeed(tenantId);
  if (!seeded.ok) return failed(seeded.error ?? "seed failed", tenantId, seeded.counts, steps);
  done("seed");

  // The order entry below uses the waiter's token only; the kitchen mark (owner, admin or chef) uses the chef's.
  const waiter = await deps.createStaff(tenantId, "waiter");
  const signedIn = await deps.staffSignIn(waiter.email, waiter.password);
  if (signedIn.session === null)
    return failed(
      `waiter sign-in refused (status ${signedIn.status})`,
      tenantId,
      seeded.counts,
      steps,
    );
  const token = signedIn.session.accessToken;
  done("waiter");
  const chef = await deps.createStaff(tenantId, "chef");
  const chefIn = await deps.staffSignIn(chef.email, chef.password);
  if (chefIn.session === null)
    return failed(`chef sign-in refused (status ${chefIn.status})`, tenantId, seeded.counts, steps);
  const chefToken = chefIn.session.accessToken;
  done("chef");

  const fail = (what: string, answer: RestAnswer) =>
    failed(`${what} refused (status ${answer.status})`, tenantId, seeded.counts, steps);

  const tables = await deps.rest(token, "POST", "/rpc/tables_list", {});
  if (tables.status !== 200) return fail("tables list", tables);
  const tableId = ((tables.body as { tables?: { id?: unknown }[] } | null)?.tables ?? [])
    .map((t) => t.id)
    .find((id) => typeof id === "string");
  if (typeof tableId !== "string")
    return failed("the seeded tenant has no table", tenantId, seeded.counts, steps);

  const menu = await deps.rest(token, "POST", "/rpc/menu_list", {});
  if (menu.status !== 200) return fail("menu list", menu);
  const items = (
    (menu.body as { categories?: { items?: unknown[] }[] } | null)?.categories ?? []
  ).flatMap((c) => c.items ?? []) as {
    id?: unknown;
    course?: unknown;
    available?: unknown;
    priceUnit?: unknown;
  }[];
  const dish = items.find(
    (item) =>
      item.available === true &&
      item.priceUnit !== "etto" &&
      typeof item.id === "string" &&
      typeof item.course === "string",
  );
  if (dish === undefined)
    return failed("the seeded tenant has no dish that can be sold", tenantId, seeded.counts, steps);

  const sessionId = deps.newId();
  const open = await deps.rest(token, "POST", "/rpc/open_table", {
    p_table: tableId,
    p_session: sessionId,
    p_covers: 2,
  });
  if (open.status !== 200) return fail("open table", open);
  done("open");

  const lineId = deps.newId();
  const added = await deps.rest(token, "POST", "/rpc/add_order_line", {
    p_session: sessionId,
    p_body: { lineId, menuItemId: dish.id, course: dish.course, clientUpdatedAt: deps.stamp() },
  });
  if (added.status !== 200) return fail("add line", added);
  done("add");

  const fired = await deps.rest(token, "POST", "/rpc/fire_course", {
    p_session: sessionId,
    p_body: { lineIds: [lineId] },
  });
  if (fired.status !== 200) return fail("fire course", fired);
  done("fire");

  // Marking the line done writes the kitchen_event rows the T4 clones and the kitchen_tickets measurement need.
  const marked = await deps.rest(chefToken, "POST", "/rpc/kitchen_mark_line", {
    p_line: lineId,
    p_body: { done: true },
  });
  if (marked.status !== 200) return fail("kitchen mark", marked);
  done("mark");

  return { ok: true, tenantId, counts: seeded.counts, steps };
}

/** One JSON line: the tenant id for the SQL calls, the seed counts and the steps. Refuses (throws) a value that looks like a token, key, address or URL. */
export function formatT4Seed(
  target: "local" | "temp",
  result: T4SeedResult,
  secrets: readonly string[],
): string {
  const report = { check: "t4-seed", target, ...result };
  assertClean(report, secrets);
  return JSON.stringify(report);
}
