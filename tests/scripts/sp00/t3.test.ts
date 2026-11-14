import { describe, expect, it, vi, type Mock } from "vitest";
import type { AuthResult } from "../../../scripts/lib/sp00/common";
import type { CaseReport } from "../../../scripts/lib/sp00/report";
import { runT3, type SwitchAnswer, type T3Deps } from "../../../scripts/lib/sp00/t3";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SID = "11111111-1111-4111-8111-111111111111";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256" })}.${b64(claims)}.c2lnbmF0dXJl`;
const tok = (claims: Record<string, unknown>) => jwt({ session_id: SID, aal: "aal2", ...claims });
const sess = (accessToken: string, refreshToken: string): AuthResult => ({
  status: 200,
  code: null,
  session: { accessToken, refreshToken },
});

const TOKEN_AAL1 = tok({ aal: "aal1" });
const TOKEN_AAL2_NONE = tok({});
const TOKEN_A = tok({ tenant_id: A, app_role: "admin" });
const TOKEN_B = tok({ tenant_id: B, app_role: "admin" });

const PREFLIGHT_OK: CaseReport = { id: "preflight", result: "pass", detail: { status: 200 } };
type Mocked = { [K in keyof T3Deps]: Mock<T3Deps[K]> };

function switched(tenant: string, token: string, wallMs = 42): SwitchAnswer {
  return {
    select: { status: 204, code: null },
    refresh: sess(token, `r-${tenant.slice(0, 1)}`),
    getClaims: { tenant_id: tenant },
    wallMs,
  };
}

function makeDeps(overrides: Partial<T3Deps> = {}): Mocked {
  const tenants = [A, B, C];
  const base: T3Deps = {
    createTenant: async () => tenants.shift() ?? "x",
    createUser: async () => ({ id: "u-1", status: 200, code: null }),
    addMembership: async () => ({ status: 201, code: null }),
    passwordSignIn: async () => sess(TOKEN_AAL1, "r-0"),
    refresh: async () => sess(TOKEN_B, "r-B2"),
    enrolTotp: async () => ({
      status: 200,
      code: null,
      factorId: "f-1",
      secret: "JBSWY3DPEHPK3PXP",
    }),
    verifyTotp: async () => sess(TOKEN_AAL2_NONE, "r-1"),
    totpCode: () => "424242",
    switchTenant: async (_session, tenant) =>
      tenant === A ? switched(A, TOKEN_A) : switched(B, TOKEN_B, 17),
    rest: async (token, method, path) => {
      if (path.startsWith("/tenant")) {
        if (token === TOKEN_A) return { status: 200, code: null, body: [{ id: A }] };
        return { status: 200, code: null, body: [{ id: B }] };
      }
      return { status: 403, code: "42501", body: null }; // sp0_select_tenant(C)
    },
    newId: () => "a1b2c3d4-0000-4000-8000-123456789012",
    newPassword: () => "P".repeat(43),
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(base).map(([name, fn]) => [name, vi.fn(fn as (...args: never[]) => unknown)]),
  ) as unknown as Mocked;
}

const byId = (cases: CaseReport[], id: string) => cases.find((c) => c.id === id);
const results = (cases: CaseReport[]) => cases.map((c) => [c.id, c.result]);

describe("runT3", () => {
  it("passes a to e and records f and g", async () => {
    const { cases, cleanup } = await runT3(makeDeps(), "local", null);
    expect(results(cases)).toEqual([
      ["a", "pass"],
      ["b", "pass"],
      ["c", "pass"],
      ["d", "pass"],
      ["e", "pass"],
      ["f", "recorded"],
      ["g", "recorded"],
    ]);
    expect(byId(cases, "g")?.detail).toEqual({ wallMs: 42 });
    expect(byId(cases, "f")?.detail).toEqual({ status: 200, stillReadsA: true, rows: 1 });
    expect(cleanup).toEqual({ created: 4, deleted: 0, kept: 4 });
  });

  it("creates three fake tenants and a user with admin memberships in A and B only", async () => {
    const deps = makeDeps();
    await runT3(deps, "local", null);
    const names = deps.createTenant.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names).toEqual(["SP0 Test A", "SP0 Test B", "SP0 Test C"]);
    const vats = deps.createTenant.mock.calls.map((c) => (c[0] as { vatNumber: string }).vatNumber);
    for (const vat of vats) expect(vat).toMatch(/^IT98\d{9}$/);
    expect(new Set(vats).size).toBe(3);
    for (const call of deps.createTenant.mock.calls)
      expect((call[0] as { ownerEmail: string }).ownerEmail).toMatch(/@example\.test$/);
    expect(deps.addMembership.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      [A, "u-1", "admin"],
      [B, "u-1", "admin"],
    ]);
  });

  it("a: fails when the aal2 token already has a tenant claim (two memberships, no selection)", async () => {
    const deps = makeDeps({
      verifyTotp: async () => sess(tok({ tenant_id: A, app_role: "admin" }), "r-1"),
    });
    expect(byId((await runT3(deps, "local", null)).cases, "a")).toMatchObject({
      result: "fail",
      detail: { tenantClaim: true },
    });
  });

  it("a: fails when the token after TOTP is not aal2", async () => {
    const deps = makeDeps({ verifyTotp: async () => sess(tok({ aal: "aal1" }), "r-1") });
    expect(byId((await runT3(deps, "local", null)).cases, "a")?.result).toBe("fail");
  });

  it("a: a refused TOTP enrolment fails with status and code, and the later cases are inconclusive", async () => {
    const deps = makeDeps({
      enrolTotp: async () => ({
        status: 422,
        code: "mfa_totp_enroll_not_enabled",
        factorId: null,
        secret: null,
      }),
    });
    const { cases } = await runT3(deps, "local", null);
    expect(byId(cases, "a")).toEqual({
      id: "a",
      result: "fail",
      detail: { status: 422, code: "mfa_totp_enroll_not_enabled" },
    });
    expect(byId(cases, "b")).toEqual({
      id: "b",
      result: "inconclusive",
      detail: { reason: "no aal2 session from case a" },
    });
  });

  it("b: calls switchTenant with the aal2 session and A, and records the select and the jar's token", async () => {
    const deps = makeDeps();
    await runT3(deps, "local", null);
    const [session, tenant] = deps.switchTenant.mock.calls[0] as unknown as [
      { accessToken: string },
      string,
    ];
    expect(session.accessToken).toBe(TOKEN_AAL2_NONE);
    expect(tenant).toBe(A);
  });

  it.each([
    ["the jar still holds the old token", switched(A, TOKEN_AAL2_NONE)],
    ["aal is aal1", switched(A, tok({ tenant_id: A, app_role: "admin", aal: "aal1" }))],
    [
      "session_id changed",
      switched(
        A,
        tok({
          tenant_id: A,
          app_role: "admin",
          session_id: "22222222-2222-4222-8222-222222222222",
        }),
      ),
    ],
    ["the role is not admin", switched(A, tok({ tenant_id: A, app_role: "owner" }))],
    [
      "getClaims on the same client does not return A",
      { ...switched(A, TOKEN_A), getClaims: { tenant_id: B } },
    ],
    ["the select was refused", { ...switched(A, TOKEN_A), select: { status: 403, code: "42501" } }],
    [
      "the refresh gave no session",
      {
        ...switched(A, TOKEN_A),
        refresh: { status: 500, code: "hook", session: null } as AuthResult,
      },
    ],
  ])("b: fails when %s", async (_name, answer) => {
    const deps = makeDeps({
      switchTenant: async (_s, tenant) =>
        tenant === A ? (answer as SwitchAnswer) : switched(B, TOKEN_B),
    });
    expect(byId((await runT3(deps, "local", null)).cases, "b")?.result).toBe("fail");
  });

  it("c: fails when the token for A reads B's row (or two rows)", async () => {
    for (const body of [[{ id: B }], [{ id: A }, { id: B }], []]) {
      const deps = makeDeps({
        rest: async (token, _m, path) =>
          path.startsWith("/tenant")
            ? { status: 200, code: null, body }
            : { status: 403, code: "42501", body: null },
      });
      expect(byId((await runT3(deps, "local", null)).cases, "c")?.result).toBe("fail");
    }
  });

  it("d: switching to B gives B only, aal2, the same session", async () => {
    const deps = makeDeps();
    const { cases } = await runT3(deps, "local", null);
    const [session, tenant] = deps.switchTenant.mock.calls[1] as unknown as [
      { accessToken: string },
      string,
    ];
    expect(session.accessToken).toBe(TOKEN_A);
    expect(tenant).toBe(B);
    expect(byId(cases, "d")?.result).toBe("pass");
  });

  it("d: fails when the token for B reads A's row", async () => {
    const deps = makeDeps({
      rest: async (_t, _m, path) =>
        path.startsWith("/tenant")
          ? { status: 200, code: null, body: [{ id: A }] }
          : { status: 403, code: "42501", body: null },
    });
    expect(byId((await runT3(deps, "local", null)).cases, "d")?.result).toBe("fail");
  });

  it("e: an accepted selection of C fails; a refused one (42501) passes only if the next refresh still carries B", async () => {
    const accepted = makeDeps({
      rest: async (_t, _m, path) =>
        path.startsWith("/tenant")
          ? { status: 200, code: null, body: [{ id: B }] }
          : { status: 204, code: null, body: null },
    });
    expect(byId((await runT3(accepted, "local", null)).cases, "e")?.result).toBe("fail");
    const lost = makeDeps({
      refresh: async () => sess(tok({ tenant_id: C, app_role: "admin" }), "r"),
    });
    expect(byId((await runT3(lost, "local", null)).cases, "e")?.result).toBe("fail");
    const select = makeDeps();
    await runT3(select, "local", null);
    const call = select.rest.mock.calls.find((c) => String(c[2]).includes("sp0_select_tenant"));
    expect(call?.[3]).toEqual({ p_tenant: C });
    expect(call?.[0]).toBe(TOKEN_B);
  });

  it("f: records that the earlier A token no longer reads A (expired or denied), without failing", async () => {
    const deps = makeDeps({
      rest: async (token, _m, path) =>
        path.startsWith("/tenant") && token === TOKEN_A
          ? { status: 401, code: "PGRST303", body: null }
          : path.startsWith("/tenant")
            ? { status: 200, code: null, body: [{ id: B }] }
            : { status: 403, code: "42501", body: null },
    });
    const { cases } = await runT3(deps, "local", null);
    expect(byId(cases, "f")).toEqual({
      id: "f",
      result: "recorded",
      detail: { status: 401, stillReadsA: false, rows: null },
    });
  });

  it("g: records the wall time of step b", async () => {
    const deps = makeDeps({
      switchTenant: async (_s, tenant) =>
        switched(tenant, tenant === A ? TOKEN_A : TOKEN_B, tenant === A ? 123 : 9),
    });
    expect(byId((await runT3(deps, "local", null)).cases, "g")).toEqual({
      id: "g",
      result: "recorded",
      detail: { wallMs: 123 },
    });
  });

  it("never reports the TOTP secret, a code, a token, an address or a URL", async () => {
    const { cases } = await runT3(makeDeps(), "local", null);
    expect(JSON.stringify(cases)).not.toMatch(/@|https?:|eyJ|JBSWY3DP|424242/);
  });

  it("the TOTP code is computed from the secret", async () => {
    const deps = makeDeps({
      totpCode: (secret: string) => (secret === "JBSWY3DPEHPK3PXP" ? "777777" : "bad"),
    });
    await runT3(deps, "local", null);
    expect(deps.verifyTotp.mock.calls[0]?.[2]).toBe("777777");
  });

  it("a failed preflight runs nothing; hosted needs the preflight", async () => {
    const deps = makeDeps();
    const failed: CaseReport = {
      id: "preflight",
      result: "inconclusive",
      detail: { status: 401, reason: "secret key not injected" },
    };
    const { cases } = await runT3(deps, "temp", failed);
    expect(results(cases)).toEqual(
      ["a", "b", "c", "d", "e", "f", "g"].map((id) => [id, "inconclusive"]),
    );
    for (const fn of Object.values(deps)) expect(fn).not.toHaveBeenCalled();
    await expect(runT3(makeDeps(), "temp", null)).rejects.toThrow(/preflight/);
    expect(byId((await runT3(makeDeps(), "temp", PREFLIGHT_OK)).cases, "a")?.result).toBe("pass");
  });

  it("setup failures make every case inconclusive and name the step; created users are counted", async () => {
    const tenants = await runT3(
      makeDeps({
        createTenant: async () => {
          throw new TypeError("x");
        },
      }),
      "local",
      null,
    );
    expect(byId(tenants.cases, "a")?.detail).toEqual({
      reason: "setup failed: tenants",
      error: "TypeError",
    });
    expect(tenants.cleanup).toEqual({ created: 0, deleted: 0, kept: 0 });
    const user = await runT3(
      makeDeps({ createUser: async () => ({ id: null, status: 422, code: "email_exists" }) }),
      "local",
      null,
    );
    expect(byId(user.cases, "a")?.detail).toEqual({ reason: "setup failed: user" });
    expect(user.cleanup).toEqual({ created: 3, deleted: 0, kept: 3 });
    const member = await runT3(
      makeDeps({ addMembership: async () => ({ status: 409, code: "23505" }) }),
      "local",
      null,
    );
    expect(byId(member.cases, "a")?.detail).toEqual({ reason: "setup failed: membership" });
    expect(member.cleanup).toEqual({ created: 4, deleted: 0, kept: 4 });
  });

  it("a thrown error in a case is inconclusive with the error name only", async () => {
    const deps = makeDeps({
      rest: async () => {
        throw new TypeError("fetch failed https://x.supabase.co");
      },
    });
    const { cases } = await runT3(deps, "local", null);
    expect(byId(cases, "c")).toEqual({
      id: "c",
      result: "inconclusive",
      detail: { reason: "request failed", error: "TypeError" },
    });
  });

  describe("an Auth 429 is inconclusive at every point an Auth answer is judged", () => {
    const limited = { status: 429, code: "over_request_rate_limit", session: null };
    const rateDetail = { status: 429, code: "over_request_rate_limit" };

    it("a: password sign-in, TOTP enrolment and TOTP verification", async () => {
      const signIn = await runT3(makeDeps({ passwordSignIn: async () => limited }), "local", null);
      expect(byId(signIn.cases, "a")).toEqual({
        id: "a",
        result: "inconclusive",
        detail: rateDetail,
      });
      const enrol = await runT3(
        makeDeps({
          enrolTotp: async () => ({
            status: 429,
            code: "over_request_rate_limit",
            factorId: null,
            secret: null,
          }),
        }),
        "local",
        null,
      );
      expect(byId(enrol.cases, "a")).toEqual({
        id: "a",
        result: "inconclusive",
        detail: rateDetail,
      });
      const verify = await runT3(makeDeps({ verifyTotp: async () => limited }), "local", null);
      expect(byId(verify.cases, "a")).toEqual({
        id: "a",
        result: "inconclusive",
        detail: rateDetail,
      });
    });

    it("b and d: the refresh inside the switch", async () => {
      const deps = makeDeps({
        switchTenant: async (_s, tenant) =>
          tenant === A ? { ...switched(A, TOKEN_A), refresh: limited } : switched(B, TOKEN_B),
      });
      const { cases } = await runT3(deps, "local", null);
      expect(byId(cases, "b")).toMatchObject({
        result: "inconclusive",
        detail: { status: 429, code: "over_request_rate_limit" },
      });
      const dLimited = makeDeps({
        switchTenant: async (_s, tenant) =>
          tenant === A ? switched(A, TOKEN_A) : { ...switched(B, TOKEN_B), refresh: limited },
      });
      expect(byId((await runT3(dLimited, "local", null)).cases, "d")?.result).toBe("inconclusive");
    });

    it("e: the refresh after the refused selection", async () => {
      const refreshes = [limited];
      const deps = makeDeps({ refresh: async () => refreshes.shift() ?? limited });
      expect(byId((await runT3(deps, "local", null)).cases, "e")).toMatchObject({
        result: "inconclusive",
        detail: { status: 429 },
      });
    });
  });
});
