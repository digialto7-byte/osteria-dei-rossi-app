// SP0 spike (§3.4, S9), T2: does the stack accept `role = 'platform_staff'` in an access token, and does that role reach nothing it
// should not (PostgREST tables, Storage, Realtime)? All I/O is injected, so the unit test drives it with fakes. The owner uploads the
// fake object and inserts the probe row with its OWN token (no secret key). The report holds statuses, codes, role names and
// booleans; never a token, an address, a URL or an object path.
import type { CreateTenantInput } from "../create-tenant";
import {
  attemptCase,
  crashKeeping,
  refusedCase,
  claimsOf,
  errorName,
  notRun,
  type AuthResult,
  type Session,
} from "./common";
import type { CaseReport, Cleanup } from "./report";

export interface RestAnswer {
  status: number | null;
  code: string | null;
  body: unknown;
}
export interface StorageAnswer {
  status: number | null;
  code: string | null;
  /** Objects listed, for a list call. */
  count: number | null;
  /** Bytes returned, for a download call. */
  bytes: number | null;
}
/**
 * The shape of one Realtime change message: which key paths carry a value, the event type and table, and the error texts. Never the
 * values themselves (the evidence goes into the job output and the plan's results).
 */
export interface PayloadShape {
  eventType: string | null;
  table: string | null;
  commitTimestamp: boolean;
  valued: { new: string[]; old: string[]; record: string[] };
  errors: string[];
}

export interface RealtimeAnswer {
  ownerJoin: string;
  consoleJoin: string;
  /** Every change message each subscriber got, as shapes. */
  owner: PayloadShape[];
  console: PayloadShape[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const valuedKeys = (section: unknown): string[] =>
  isObject(section)
    ? Object.keys(section)
        .filter((key) => section[key] !== null && section[key] !== undefined)
        .sort()
    : [];

export function shapeOf(payload: unknown): PayloadShape {
  const p = isObject(payload) ? payload : {};
  return {
    eventType: typeof p.eventType === "string" ? p.eventType : null,
    table: typeof p.table === "string" ? p.table : null,
    commitTimestamp: typeof p.commit_timestamp === "string" && p.commit_timestamp !== "",
    valued: { new: valuedKeys(p.new), old: valuedKeys(p.old), record: valuedKeys(p.record) },
    errors: Array.isArray(p.errors)
      ? p.errors.filter((e): e is string => typeof e === "string").map((e) => e.slice(0, 80))
      : [],
  };
}

/** One line per shape, for the report (its detail holds flat values): key paths and error texts, no values. */
export function shapeText(shape: PayloadShape): string {
  const list = (keys: string[]) => `[${keys.join(",")}]`;
  return [
    shape.eventType ?? "-",
    shape.table ?? "-",
    shape.commitTimestamp ? "ts" : "no-ts",
    `new${list(shape.valued.new)}`,
    `old${list(shape.valued.old)}`,
    `record${list(shape.valued.record)}`,
    `errors${list(shape.errors)}`,
  ].join(" ");
}

/** The probe row's columns: any of them carrying a value in a console message is a leak. */
const PROBE_COLUMNS = ["id", "tenant_id", "note"];
const carriesRow = (shape: PayloadShape): boolean =>
  [...shape.valued.new, ...shape.valued.old, ...shape.valued.record].some((key) =>
    PROBE_COLUMNS.includes(key),
  );
const isRefusal = (shape: PayloadShape): boolean =>
  !carriesRow(shape) && shape.errors.some((e) => /\b401\b|unauthori[sz]ed/i.test(e));

export interface T2Deps {
  /** `createTenant` of scripts/create-tenant.ts with the spike's admin client. Returns the tenant id. */
  createTenant(input: CreateTenantInput): Promise<string>;
  /** Admin: gives the (script-created) owner a password so it can sign in. */
  setOwnerPassword(email: string, password: string): Promise<{ error: unknown }>;
  passwordSignIn(email: string, password: string): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  /** A PostgREST call with a USER token. `path` is relative to `/rest/v1`. */
  rest(
    accessToken: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<RestAnswer>;
  /** The owner uploads the fake object with its own token. `path` is relative to the `invoices` bucket. */
  upload(
    accessToken: string,
    path: string,
  ): Promise<{ status: number | null; code: string | null }>;
  storage(accessToken: string, op: "list" | "download", path: string): Promise<StorageAnswer>;
  signOut(accessToken: string): Promise<{ status: number | null }>;
  /** Subscribes both tokens to `postgres_changes` on sp0_rt_probe, calls `insert` once both joined, waits, reports who got the event. */
  realtimeProbe(input: {
    consoleToken: string;
    ownerToken: string;
    insert: () => Promise<void>;
  }): Promise<RealtimeAnswer>;
  newId(): string;
  newPassword(): string;
}

export interface T2Outcome {
  cases: CaseReport[];
  cleanup: Cleanup;
}

const CASE_IDS = ["a", "b", "c", "d", "e", "f", "g"] as const;
const NO_CONSOLE = "no console token";

const ok2xx = (status: number | null) => status !== null && status >= 200 && status < 300;
const denied = (r: RestAnswer) => r.code === "42501" || r.status === 401 || r.status === 403;
const empty = (r: RestAnswer) => r.status === 200 && Array.isArray(r.body) && r.body.length === 0;

function roleAndTenant(token: string): { role: string | null; tenantClaim: boolean } | null {
  const claims = claimsOf(token);
  if (claims === null) return null;
  return {
    role: typeof claims.role === "string" ? claims.role : null,
    tenantClaim: "tenant_id" in claims,
  };
}

function allInconclusive(reason: string, error?: string): T2Outcome {
  const cases = notRun(CASE_IDS, reason);
  if (error !== undefined) for (const item of cases) item.detail = { ...item.detail, error };
  return { cases, cleanup: { created: 0, deleted: 0, kept: 0 } };
}

export async function runT2(
  deps: T2Deps,
  target: "local" | "temp",
  preflight: CaseReport | null,
): Promise<T2Outcome> {
  if (target === "temp" && preflight === null) {
    throw new Error("T2 on the temporary project needs the preflight result first.");
  }
  if (preflight !== null && preflight.result !== "pass") return allInconclusive("preflight failed");

  // Setup: the owner of a fresh fake tenant, with a password, signed in.
  const idPart = deps
    .newId()
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  const email = `sp0-t2-${idPart}@example.test`;
  const digits = deps.newId().replace(/\D/g, "").slice(0, 9).padEnd(9, "0");
  let tenantId: string;
  try {
    tenantId = await deps.createTenant({
      name: "SP0 Test T2",
      vatNumber: `IT98${digits}`,
      ownerEmail: email,
      ownerName: "SP0 T2 Owner",
    });
  } catch (error) {
    return allInconclusive("setup failed: tenant", errorName(error));
  }
  // The owner has a membership: it cannot be deleted and stays until the runner or the project is gone.
  const cleanup: Cleanup = { created: 1, deleted: 0, kept: 1 };
  const setupFailed = (step: string): T2Outcome => ({
    cases: notRun(CASE_IDS, `setup failed: ${step}`),
    cleanup,
  });

  const password = deps.newPassword();
  const passwordSet = await crashKeeping(
    () => cleanup,
    () => deps.setOwnerPassword(email, password),
  );
  if (passwordSet.error) return setupFailed("password");
  const signedIn = await crashKeeping(
    () => cleanup,
    () => deps.passwordSignIn(email, password),
  );
  if (signedIn.session === null) return setupFailed("owner sign-in");
  const ownerToken = signedIn.session.accessToken;
  const ownerRefresh = signedIn.session.refreshToken;

  const objectPath = `${tenantId}/1998/${deps.newId()}.pdf`;
  const folderPath = `${tenantId}/1998`;
  const uploaded = await crashKeeping(
    () => cleanup,
    () => deps.upload(ownerToken, objectPath),
  );

  const cases: CaseReport[] = [];
  const add = async (id: string, run: () => Promise<CaseReport>) =>
    cases.push(await attemptCase(id, run));

  // Case a: into the console and the refresh that issues the console token.
  let consoleSession: Session | null = null;
  await add("a", async (): Promise<CaseReport> => {
    const selected = await deps.rest(ownerToken, "POST", "/rpc/sp0_select_console", {});
    if (!ok2xx(selected.status)) {
      return {
        id: "a",
        result: "fail",
        detail: { reason: "select console refused", status: selected.status, code: selected.code },
      };
    }
    const refreshed = await deps.refresh(ownerRefresh);
    if (refreshed.session === null) return refusedCase("a", refreshed.status, refreshed.code);
    const claims = roleAndTenant(refreshed.session.accessToken);
    if (claims === null)
      return { id: "a", result: "fail", detail: { reason: "token not readable" } };
    consoleSession = refreshed.session;
    const pass = claims.role === "platform_staff" && !claims.tenantClaim;
    return {
      id: "a",
      result: pass ? "pass" : "fail",
      detail: { role: claims.role, tenantClaim: claims.tenantClaim },
    };
  });

  const withConsole = async (id: string, run: (console: Session) => Promise<CaseReport>) => {
    const current = consoleSession;
    if (current === null)
      cases.push({ id, result: "inconclusive", detail: { reason: NO_CONSOLE } });
    else await add(id, () => run(current));
  };

  await withConsole("b", async ({ accessToken: token }): Promise<CaseReport> => {
    const ping = await deps.rest(token, "POST", "/rpc/sp0_platform_ping", {});
    const body = ping.body as { current_user?: unknown; tenant_claim?: unknown } | null;
    const currentUser = typeof body?.current_user === "string" ? body.current_user : null;
    const tenantClaim = typeof body?.tenant_claim === "boolean" ? body.tenant_claim : null;
    const pass = ping.status === 200 && currentUser === "platform_staff" && tenantClaim === false;
    return {
      id: "b",
      result: pass ? "pass" : "fail",
      detail: { status: ping.status, currentUser, tenantClaim },
    };
  });

  await withConsole("c", async ({ accessToken: token }): Promise<CaseReport> => {
    const tenant = await deps.rest(token, "GET", "/tenant?select=id");
    const dashboard = await deps.rest(token, "POST", "/rpc/dashboard_summary", {});
    const safe = (r: RestAnswer) => denied(r) || empty(r);
    return {
      id: "c",
      result: safe(tenant) && safe(dashboard) ? "pass" : "fail",
      detail: {
        tenantStatus: tenant.status,
        tenantCode: tenant.code,
        dashboardStatus: dashboard.status,
        dashboardCode: dashboard.code,
      },
    };
  });

  await withConsole("f", async ({ accessToken: token }): Promise<CaseReport> => {
    const consoleList = await deps.storage(token, "list", folderPath);
    const consoleDownload = await deps.storage(token, "download", objectPath);
    const ownerList = await deps.storage(ownerToken, "list", folderPath);
    const ownerDownload = await deps.storage(ownerToken, "download", objectPath);
    const detail = {
      consoleListStatus: consoleList.status,
      consoleListCode: consoleList.code,
      consoleListCount: consoleList.count,
      consoleDownloadStatus: consoleDownload.status,
      consoleDownloadCode: consoleDownload.code,
      ownerListStatus: ownerList.status,
      ownerDownloadStatus: ownerDownload.status,
    };
    const leaked =
      (consoleList.count ?? 0) > 0 ||
      (consoleDownload.status === 200 && (consoleDownload.bytes ?? 0) > 0);
    if (leaked) return { id: "f", result: "fail", detail };
    const controlOk =
      ownerList.status === 200 &&
      (ownerList.count ?? 0) > 0 &&
      ownerDownload.status === 200 &&
      (ownerDownload.bytes ?? 0) > 0;
    if (!controlOk)
      return {
        id: "f",
        result: "inconclusive",
        detail: { ...detail, reason: "owner control failed", uploadStatus: uploaded.status },
      };
    return { id: "f", result: "pass", detail };
  });

  await withConsole("g", async ({ accessToken: token }): Promise<CaseReport> => {
    // The probe may insert more than once (until the owner control sees a row); every insert must succeed.
    const inserted: { count: number; failed: number | null } = { count: 0, failed: null };
    const answer = await deps.realtimeProbe({
      consoleToken: token,
      ownerToken,
      insert: async () => {
        const row = await deps.rest(ownerToken, "POST", "/sp0_rt_probe", {
          tenant_id: tenantId,
          note: "sp0",
        });
        inserted.count += 1;
        if (!ok2xx(row.status) && inserted.failed === null) inserted.failed = row.status;
      },
    });
    const detail = {
      ownerJoin: answer.ownerJoin,
      consoleJoin: answer.consoleJoin,
      owner: answer.owner.map(shapeText),
      console: answer.console.map(shapeText),
      // Even a refusal tells the console that an event happened on the table, and when: recorded for SP3 (console sessions never open Realtime).
      consoleRefusals: answer.console.filter(isRefusal).length,
      inserts: inserted.count,
    };
    // A leak is graded first (lead 2026-11-14): row data reaching the console fails even when a later insert failed.
    if (answer.console.some(carriesRow)) return { id: "g", result: "fail", detail };
    if (inserted.count === 0 || inserted.failed !== null)
      return {
        id: "g",
        result: "inconclusive",
        detail: { reason: "probe insert failed", status: inserted.failed, ...detail },
      };
    if (!answer.console.every(isRefusal))
      return {
        id: "g",
        result: "inconclusive",
        detail: {
          ...detail,
          reason: "console got a message that is neither row data nor an explicit refusal",
        },
      };
    if (answer.ownerJoin !== "SUBSCRIBED")
      return {
        id: "g",
        result: "inconclusive",
        detail: { ...detail, reason: "owner control did not subscribe" },
      };
    if (!answer.owner.some(carriesRow))
      return {
        id: "g",
        result: "inconclusive",
        detail: { ...detail, reason: "owner control received nothing" },
      };
    return { id: "g", result: "pass", detail };
  });

  // Case d: leave the console as platform_staff, then refresh: the tenant token is back.
  let latestRefresh: string | null = null;
  let latestToken: string = ownerToken;
  await withConsole("d", async ({ accessToken: token, refreshToken }): Promise<CaseReport> => {
    const left = await deps.rest(token, "POST", "/rpc/sp0_leave_console", {});
    if (!ok2xx(left.status))
      return {
        id: "d",
        result: "fail",
        detail: { reason: "leave refused", status: left.status, code: left.code },
      };
    const refreshed = await deps.refresh(refreshToken);
    if (refreshed.session === null) return refusedCase("d", refreshed.status, refreshed.code);
    latestRefresh = refreshed.session.refreshToken;
    latestToken = refreshed.session.accessToken;
    const claims = roleAndTenant(refreshed.session.accessToken);
    if (claims === null)
      return { id: "d", result: "fail", detail: { reason: "token not readable" } };
    const tenantAgain = claimsOf(refreshed.session.accessToken)?.tenant_id === tenantId;
    return {
      id: "d",
      result: claims.role === "authenticated" && tenantAgain ? "pass" : "fail",
      detail: { role: claims.role, tenantClaim: claims.tenantClaim },
    };
  });

  // Case e: back into the console, then sign out with the console token.
  await withConsole("e", async (): Promise<CaseReport> => {
    const selected = await deps.rest(latestToken, "POST", "/rpc/sp0_select_console", {});
    if (!ok2xx(selected.status) || latestRefresh === null) {
      return {
        id: "e",
        result: "inconclusive",
        detail: { reason: "could not re-enter the console", status: selected.status },
      };
    }
    const refreshed = await deps.refresh(latestRefresh);
    if (refreshed.session === null) {
      return {
        id: "e",
        result: "inconclusive",
        detail: { reason: "could not re-enter the console", status: refreshed.status },
      };
    }
    if (roleAndTenant(refreshed.session.accessToken)?.role !== "platform_staff") {
      return {
        id: "e",
        result: "fail",
        detail: {
          reason: "the token to sign out with is not a console token",
          role: roleAndTenant(refreshed.session.accessToken)?.role ?? null,
        },
      };
    }
    const out = await deps.signOut(refreshed.session.accessToken);
    const result = ok2xx(out.status) ? "pass" : out.status === 429 ? "inconclusive" : "fail";
    return { id: "e", result, detail: { status: out.status } };
  });

  cases.sort((x, y) => x.id.localeCompare(y.id));
  return { cases, cleanup };
}
