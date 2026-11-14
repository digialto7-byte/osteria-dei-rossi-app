// SP0 spike (§3.4, S10), T3: switching tenant with one server-side refresh keeps `aal2` and the session. All I/O is injected, so the
// unit test drives it with fakes. The report holds booleans, statuses, codes and a wall time; never a token, a TOTP secret or code, an
// address or a URL. Every user created here has a membership, so none is deleted (counted as kept).
import type { CreateTenantInput } from "../create-tenant";
import { attemptCase, claimsOf, errorName, notRun, type AuthResult, type Session } from "./common";
import type { CaseReport, Cleanup } from "./report";
import type { RestAnswer } from "./t2";

export interface SwitchAnswer {
  /** `rpc('sp0_select_tenant', ...)` on the server client. */
  select: { status: number | null; code: string | null };
  /** `auth.refreshSession()` on the same client: the token the cookie jar then holds. */
  refresh: AuthResult;
  /** `getClaims()` on the same client right after the refresh. */
  getClaims: Record<string, unknown> | null;
  /** Wall time of the two calls, in milliseconds. */
  wallMs: number;
}

export interface T3Deps {
  createTenant(input: CreateTenantInput): Promise<string>;
  createUser(
    email: string,
    password: string,
  ): Promise<{ id: string | null; status: number | null; code: string | null }>;
  /** Admin: inserts the `app_user` row (role admin) with the secret key. */
  addMembership(
    tenantId: string,
    authId: string,
    role: "admin",
    displayName: string,
  ): Promise<{ status: number | null; code: string | null }>;
  passwordSignIn(email: string, password: string): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  enrolTotp(accessToken: string): Promise<{
    status: number | null;
    code: string | null;
    factorId: string | null;
    secret: string | null;
  }>;
  verifyTotp(accessToken: string, factorId: string, code: string): Promise<AuthResult>;
  totpCode(secret: string): string;
  /** One function on one `@supabase/ssr` server client with a cookie jar: select the tenant, then refresh. */
  switchTenant(session: Session, tenantId: string): Promise<SwitchAnswer>;
  rest(
    accessToken: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<RestAnswer>;
  newId(): string;
  newPassword(): string;
}

export interface T3Outcome {
  cases: CaseReport[];
  cleanup: Cleanup;
}

const CASE_IDS = ["a", "b", "c", "d", "e", "f", "g"] as const;
const NO_AAL2 = "no aal2 session from case a";

const stringClaim = (claims: Record<string, unknown> | null, name: string): string | null => {
  const value = claims?.[name];
  return typeof value === "string" && value !== "" ? value : null;
};
const ids = (answer: RestAnswer): string[] | null =>
  answer.status === 200 && Array.isArray(answer.body)
    ? (answer.body as { id?: unknown }[]).map((row) => String(row.id))
    : null;

export async function runT3(
  deps: T3Deps,
  target: "local" | "temp",
  preflight: CaseReport | null,
): Promise<T3Outcome> {
  if (target === "temp" && preflight === null) {
    throw new Error("T3 on the temporary project needs the preflight result first.");
  }
  if (preflight !== null && preflight.result !== "pass") {
    return {
      cases: notRun(CASE_IDS, "preflight failed"),
      cleanup: { created: 0, deleted: 0, kept: 0 },
    };
  }

  const idPart = deps
    .newId()
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  const digits8 = deps.newId().replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
  // Every user made here gets a membership, so it stays until the runner or the project is gone.
  const cleanup: Cleanup = { created: 0, deleted: 0, kept: 0 };
  const setupFailed = (step: string, error?: string): T3Outcome => {
    const cases = notRun(CASE_IDS, `setup failed: ${step}`);
    if (error !== undefined) for (const item of cases) item.detail = { ...item.detail, error };
    return { cases, cleanup };
  };

  const tenants: string[] = [];
  try {
    for (const [index, letter] of ["A", "B", "C"].entries()) {
      tenants.push(
        await deps.createTenant({
          name: `SP0 Test ${letter}`,
          vatNumber: `IT98${digits8}${index}`,
          ownerEmail: `sp0-t3-owner-${letter.toLowerCase()}-${idPart}@example.test`,
          ownerName: `SP0 T3 Owner ${letter}`,
        }),
      );
      cleanup.created += 1;
      cleanup.kept += 1;
    }
  } catch (error) {
    return setupFailed("tenants", errorName(error));
  }
  const [tenantA, tenantB, tenantC] = tenants as [string, string, string];

  const email = `sp0-t3-u-${idPart}@example.test`;
  const password = deps.newPassword();
  const made = await deps.createUser(email, password);
  if (made.id === null) return setupFailed("user");
  cleanup.created += 1;
  cleanup.kept += 1;
  for (const tenant of [tenantA, tenantB]) {
    const added = await deps.addMembership(tenant, made.id, "admin", "SP0 T3 U");
    if (added.status === null || added.status >= 300) return setupFailed("membership");
  }

  const cases: CaseReport[] = [];
  const add = async (id: string, run: () => Promise<CaseReport>) =>
    cases.push(await attemptCase(id, run));

  // Case a: password sign-in, then TOTP: aal2, and no tenant claim (two memberships, no selection).
  let aal2: Session | null = null;
  let baseline: string | null = null;
  await add("a", async (): Promise<CaseReport> => {
    const first = await deps.passwordSignIn(email, password);
    if (first.session === null)
      return { id: "a", result: "fail", detail: { status: first.status, code: first.code } };
    const enrolled = await deps.enrolTotp(first.session.accessToken);
    if (enrolled.factorId === null || enrolled.secret === null) {
      return { id: "a", result: "fail", detail: { status: enrolled.status, code: enrolled.code } };
    }
    const verified = await deps.verifyTotp(
      first.session.accessToken,
      enrolled.factorId,
      deps.totpCode(enrolled.secret),
    );
    if (verified.session === null)
      return { id: "a", result: "fail", detail: { status: verified.status, code: verified.code } };
    const claims = claimsOf(verified.session.accessToken);
    const aal = stringClaim(claims, "aal");
    const tenantClaim = claims !== null && ("tenant_id" in claims || "app_role" in claims);
    aal2 = verified.session;
    baseline = stringClaim(claims, "session_id");
    return {
      id: "a",
      result: aal === "aal2" && !tenantClaim ? "pass" : "fail",
      detail: { aal, tenantClaim },
    };
  });

  // b and d: switch with one server-side refresh. c and e read and test with the result.
  let current: Session | null = aal2;
  let tokenA: string | null = null;
  let wallMs: number | null = null;

  async function switchCase(id: "b" | "d", tenant: string): Promise<CaseReport> {
    if (current === null) return { id, result: "inconclusive", detail: { reason: NO_AAL2 } };
    const answer = await deps.switchTenant(current, tenant);
    if (!(answer.select.status !== null && answer.select.status < 300)) {
      return {
        id,
        result: "fail",
        detail: {
          reason: "select refused",
          status: answer.select.status,
          code: answer.select.code,
        },
      };
    }
    if (answer.refresh.session === null) {
      return {
        id,
        result: "fail",
        detail: {
          reason: "refresh gave no session",
          status: answer.refresh.status,
          code: answer.refresh.code,
        },
      };
    }
    const claims = claimsOf(answer.refresh.session.accessToken);
    const detail = {
      tenantIsSelected: stringClaim(claims, "tenant_id") === tenant,
      roleIsAdmin: stringClaim(claims, "app_role") === "admin",
      aal: stringClaim(claims, "aal"),
      sameSession: baseline !== null && stringClaim(claims, "session_id") === baseline,
      getClaimsIsSelected: stringClaim(answer.getClaims, "tenant_id") === tenant,
    };
    const pass =
      detail.tenantIsSelected &&
      detail.roleIsAdmin &&
      detail.aal === "aal2" &&
      detail.sameSession &&
      detail.getClaimsIsSelected;
    current = answer.refresh.session;
    if (id === "b") {
      tokenA = answer.refresh.session.accessToken;
      wallMs = answer.wallMs;
    }
    return { id, result: pass ? "pass" : "fail", detail };
  }

  const reads = async (token: string, only: string): Promise<CaseReport["detail"]> => {
    const answer = await deps.rest(token, "GET", "/tenant?select=id");
    const rows = ids(answer);
    return {
      status: answer.status,
      rows: rows === null ? null : rows.length,
      onlyTheSelected: rows !== null && rows.length === 1 && rows[0] === only,
    };
  };

  await add("b", () => switchCase("b", tenantA));
  await add("c", async (): Promise<CaseReport> => {
    if (tokenA === null)
      return { id: "c", result: "inconclusive", detail: { reason: "no token for A" } };
    const detail = await reads(tokenA, tenantA);
    return { id: "c", result: detail.onlyTheSelected === true ? "pass" : "fail", detail };
  });
  await add("d", async (): Promise<CaseReport> => {
    const switchResult = await switchCase("d", tenantB);
    if (switchResult.result !== "pass" || current === null) return switchResult;
    const detail = { ...switchResult.detail, ...(await reads(current.accessToken, tenantB)) };
    return { id: "d", result: detail.onlyTheSelected === true ? "pass" : "fail", detail };
  });

  // e: a tenant the user is not in is refused with 42501, and the next refresh still carries B.
  await add("e", async (): Promise<CaseReport> => {
    if (current === null) return { id: "e", result: "inconclusive", detail: { reason: NO_AAL2 } };
    const attempted = await deps.rest(current.accessToken, "POST", "/rpc/sp0_select_tenant", {
      p_tenant: tenantC,
    });
    const refused = attempted.code === "42501";
    const refreshed = await deps.refresh(current.refreshToken);
    if (refreshed.session === null) {
      return {
        id: "e",
        result: "fail",
        detail: { refused, status: refreshed.status, code: refreshed.code },
      };
    }
    const stillB = stringClaim(claimsOf(refreshed.session.accessToken), "tenant_id") === tenantB;
    return {
      id: "e",
      result: refused && stillB ? "pass" : "fail",
      detail: { refused, status: attempted.status, stillB },
    };
  });

  // f and g are recorded, not judged.
  await add("f", async (): Promise<CaseReport> => {
    if (tokenA === null)
      return { id: "f", result: "inconclusive", detail: { reason: "no token for A" } };
    const answer = await deps.rest(tokenA, "GET", "/tenant?select=id");
    const rows = ids(answer);
    return {
      id: "f",
      result: "recorded",
      detail: {
        status: answer.status,
        stillReadsA: rows !== null && rows.length === 1 && rows[0] === tenantA,
        rows: rows === null ? null : rows.length,
      },
    };
  });
  cases.push({
    id: "g",
    result: wallMs === null ? "inconclusive" : "recorded",
    detail: wallMs === null ? { reason: "step b did not run" } : { wallMs },
  });

  cases.sort((x, y) => x.id.localeCompare(y.id));
  return { cases, cleanup };
}
