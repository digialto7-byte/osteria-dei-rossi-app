import { describe, expect, it, vi, type Mock } from "vitest";
import { CheckCrash, type AuthResult } from "../../../scripts/lib/sp00/common";
import type { CaseReport } from "../../../scripts/lib/sp00/report";
import {
  runT2,
  shapeOf,
  shapeText,
  type PayloadShape,
  type RealtimeAnswer,
  type T2Deps,
} from "../../../scripts/lib/sp00/t2";

const TENANT = "11111111-1111-4111-8111-111111111111";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256" })}.${b64(claims)}.c2lnbmF0dXJl`;
const OWNER_TOKEN = jwt({
  role: "authenticated",
  tenant_id: TENANT,
  app_role: "owner",
  session_id: "s-1",
});
const CONSOLE_TOKEN = jwt({ role: "platform_staff", session_id: "s-1" });
const BACK_TOKEN = jwt({
  role: "authenticated",
  tenant_id: TENANT,
  app_role: "owner",
  session_id: "s-1",
});

const session = (accessToken: string, refreshToken: string): AuthResult => ({
  status: 200,
  code: null,
  session: { accessToken, refreshToken },
});
const PREFLIGHT_OK: CaseReport = { id: "preflight", result: "pass", detail: { status: 200 } };

type Mocked = { [K in keyof T2Deps]: Mock<T2Deps[K]> };

function makeDeps(overrides: Partial<T2Deps> = {}): Mocked {
  // Refreshes in the order the check makes them: into the console, back out, into the console again.
  const refreshes = [
    session(CONSOLE_TOKEN, "r-2"),
    session(BACK_TOKEN, "r-3"),
    session(CONSOLE_TOKEN, "r-4"),
  ];
  const base: T2Deps = {
    createTenant: async () => TENANT,
    setOwnerPassword: async () => ({ error: null }),
    passwordSignIn: async () => session(OWNER_TOKEN, "r-1"),
    refresh: async () => refreshes.shift() ?? { status: 500, code: null, session: null },
    rest: async (token, method, path) => {
      if (path.includes("sp0_platform_ping")) {
        return token === CONSOLE_TOKEN
          ? {
              status: 200,
              code: null,
              body: { current_user: "platform_staff", tenant_claim: false },
            }
          : { status: 401, code: null, body: null };
      }
      if (path.startsWith("/tenant") || path.includes("dashboard_summary")) {
        return { status: 403, code: "42501", body: null };
      }
      if (path.includes("sp0_rt_probe")) return { status: 201, code: null, body: null };
      return { status: 204, code: null, body: null }; // select / leave console
    },
    upload: async () => ({ status: 200, code: null }),
    storage: async (token, op) => {
      if (token === OWNER_TOKEN || token === BACK_TOKEN) {
        return op === "list"
          ? { status: 200, code: null, count: 1, bytes: null }
          : { status: 200, code: null, count: null, bytes: 12 };
      }
      return op === "list"
        ? { status: 200, code: null, count: 0, bytes: null }
        : { status: 400, code: "not_found", count: null, bytes: null };
    },
    signOut: async () => ({ status: 204 }),
    realtimeProbe: async ({ insert }) => {
      await insert();
      return {
        ownerJoin: "SUBSCRIBED",
        consoleJoin: "SUBSCRIBED",
        owner: [
          {
            eventType: "INSERT",
            table: "sp0_rt_probe",
            commitTimestamp: true,
            valued: { new: ["id", "note", "tenant_id"], old: [], record: [] },
            errors: [],
          },
        ],
        console: [],
      };
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

describe("runT2", () => {
  it("passes a to g when the console token is accepted and leaks nothing", async () => {
    const { cases, cleanup } = await runT2(makeDeps(), "local", null);
    expect(results(cases)).toEqual(["a", "b", "c", "d", "e", "f", "g"].map((id) => [id, "pass"]));
    expect(cleanup).toEqual({ created: 1, deleted: 0, kept: 1 });
    expect(byId(cases, "a")?.detail).toMatchObject({ role: "platform_staff", tenantClaim: false });
    expect(byId(cases, "b")?.detail).toMatchObject({ status: 200, currentUser: "platform_staff" });
  });

  it("makes 'SP0 Test T2' with an IT98 VAT and an example.test owner, and sets a 43-character password", async () => {
    const deps = makeDeps();
    await runT2(deps, "local", null);
    const [input] = deps.createTenant.mock.calls[0] as unknown as [
      { name: string; vatNumber: string; ownerEmail: string },
    ];
    expect(input.name).toBe("SP0 Test T2");
    expect(input.vatNumber).toMatch(/^IT98\d{9}$/);
    expect(input.ownerEmail).toMatch(/^[a-z0-9.-]+@example\.test$/);
    expect(deps.setOwnerPassword.mock.calls[0]?.[0]).toBe(input.ownerEmail);
    expect(deps.setOwnerPassword.mock.calls[0]?.[1]).toHaveLength(43);
  });

  it("uploads the fake object and inserts the probe row with the OWNER's token, under <tenant>/1998/<uuid>.pdf", async () => {
    const deps = makeDeps();
    await runT2(deps, "local", null);
    const [token, path] = deps.upload.mock.calls[0] as unknown as [string, string];
    expect(token).toBe(OWNER_TOKEN);
    expect(path).toMatch(new RegExp(`^${TENANT}/1998/[0-9a-f-]{36}\\.pdf$`));
    const insert = deps.rest.mock.calls.find((c) => String(c[2]).includes("sp0_rt_probe"));
    expect(insert?.[0]).toBe(OWNER_TOKEN);
    expect(insert?.[1]).toBe("POST");
    expect(insert?.[3]).toMatchObject({ tenant_id: TENANT });
    // the console token never uploads or inserts
    for (const call of deps.upload.mock.calls) expect(call[0]).not.toBe(CONSOLE_TOKEN);
  });

  it("a: fails when the refreshed token is not platform_staff, or still has a tenant claim", async () => {
    const stillTenant = jwt({ role: "platform_staff", tenant_id: TENANT });
    for (const [token, want] of [
      [OWNER_TOKEN, "authenticated"],
      [stillTenant, "platform_staff"],
    ] as const) {
      const refreshes = [session(token, "r-2"), session(BACK_TOKEN, "r-3"), session(token, "r-4")];
      const deps = makeDeps({
        refresh: async () => refreshes.shift() ?? { status: 500, code: null, session: null },
      });
      const { cases } = await runT2(deps, "local", null);
      expect(byId(cases, "a")?.result).toBe("fail");
      expect(byId(cases, "a")?.detail.role).toBe(want);
    }
  });

  it("a: fails with the status when Auth refuses to issue the console token (hook error)", async () => {
    const deps = makeDeps({
      refresh: async () => ({ status: 500, code: "hook_failed", session: null }),
    });
    const { cases } = await runT2(deps, "local", null);
    expect(byId(cases, "a")).toEqual({
      id: "a",
      result: "fail",
      detail: { status: 500, code: "hook_failed" },
    });
    expect(byId(cases, "b")?.result).toBe("inconclusive");
    expect(byId(cases, "b")?.detail).toEqual({ reason: "no console token" });
  });

  it("a: when sp0_select_console is refused, a fails and the rest are inconclusive", async () => {
    const deps = makeDeps({
      rest: async (_t, _m, path) =>
        path.includes("sp0_select_console")
          ? { status: 404, code: "PGRST202", body: null }
          : { status: 204, code: null, body: null },
    });
    const { cases } = await runT2(deps, "local", null);
    expect(byId(cases, "a")).toEqual({
      id: "a",
      result: "fail",
      detail: { reason: "select console refused", status: 404, code: "PGRST202" },
    });
    expect(byId(cases, "g")?.result).toBe("inconclusive");
  });

  it("b: fails on a 401 from the ping, and on a current_user other than platform_staff", async () => {
    const unauthorised = makeDeps({
      rest: async (_t, _m, path) =>
        path.includes("sp0_platform_ping")
          ? { status: 401, code: "PGRST301", body: null }
          : { status: 204, code: null, body: null },
    });
    expect(byId((await runT2(unauthorised, "local", null)).cases, "b")?.result).toBe("fail");
    const wrongRole = makeDeps({
      rest: async (_t, _m, path) =>
        path.includes("sp0_platform_ping")
          ? {
              status: 200,
              code: null,
              body: { current_user: "authenticated", tenant_claim: false },
            }
          : { status: 204, code: null, body: null },
    });
    const { cases } = await runT2(wrongRole, "local", null);
    expect(byId(cases, "b")?.result).toBe("fail");
    expect(byId(cases, "b")?.detail.currentUser).toBe("authenticated");
  });

  it("b: fails when the ping reports a tenant claim", async () => {
    const deps = makeDeps({
      rest: async (_t, _m, path) =>
        path.includes("sp0_platform_ping")
          ? {
              status: 200,
              code: null,
              body: { current_user: "platform_staff", tenant_claim: true },
            }
          : { status: 204, code: null, body: null },
    });
    expect(byId((await runT2(deps, "local", null)).cases, "b")?.result).toBe("fail");
  });

  it("c: a tenant row, or a dashboard_summary body, for the console token fails; denied or empty passes", async () => {
    const rowAnswer = (path: string, body: unknown) =>
      path.startsWith("/tenant") ? { status: 200, code: null, body } : undefined;
    const leaking = makeDeps({
      rest: async (token, method, path) =>
        rowAnswer(path, [{ id: TENANT }]) ??
        (path.includes("sp0_platform_ping")
          ? {
              status: 200,
              code: null,
              body: { current_user: "platform_staff", tenant_claim: false },
            }
          : { status: 204, code: null, body: null }),
    });
    expect(byId((await runT2(leaking, "local", null)).cases, "c")?.result).toBe("fail");
    const empty = makeDeps({
      rest: async (_t, _m, path) =>
        rowAnswer(path, []) ??
        (path.includes("dashboard_summary")
          ? { status: 403, code: "42501", body: null }
          : path.includes("sp0_platform_ping")
            ? {
                status: 200,
                code: null,
                body: { current_user: "platform_staff", tenant_claim: false },
              }
            : { status: 204, code: null, body: null }),
    });
    expect(byId((await runT2(empty, "local", null)).cases, "c")?.result).toBe("pass");
    const dashboardBody = makeDeps({
      rest: async (_t, _m, path) =>
        path.includes("dashboard_summary")
          ? { status: 200, code: null, body: { revenue: 1 } }
          : path.startsWith("/tenant")
            ? { status: 403, code: "42501", body: null }
            : path.includes("sp0_platform_ping")
              ? {
                  status: 200,
                  code: null,
                  body: { current_user: "platform_staff", tenant_claim: false },
                }
              : { status: 204, code: null, body: null },
    });
    expect(byId((await runT2(dashboardBody, "local", null)).cases, "c")?.result).toBe("fail");
  });

  it("d: fails when the token after leaving the console has no tenant claims", async () => {
    const noTenant = jwt({ role: "authenticated", session_id: "s-1" });
    const refreshes = [
      session(CONSOLE_TOKEN, "r-2"),
      session(noTenant, "r-3"),
      session(CONSOLE_TOKEN, "r-4"),
    ];
    const deps = makeDeps({
      refresh: async () => refreshes.shift() ?? { status: 500, code: null, session: null },
    });
    const { cases } = await runT2(deps, "local", null);
    expect(byId(cases, "d")?.result).toBe("fail");
    expect(byId(cases, "d")?.detail).toMatchObject({ role: "authenticated", tenantClaim: false });
  });

  it("d: leaving the console is called with the console token, and the refresh follows", async () => {
    const deps = makeDeps();
    await runT2(deps, "local", null);
    const leave = deps.rest.mock.calls.find((c) => String(c[2]).includes("sp0_leave_console"));
    expect(leave?.[0]).toBe(CONSOLE_TOKEN);
  });

  it("e: signs out with a console token, and fails when Auth refuses it", async () => {
    const ok = makeDeps();
    await runT2(ok, "local", null);
    expect(ok.signOut.mock.calls[0]?.[0]).toBe(CONSOLE_TOKEN);
    const refused = makeDeps({ signOut: async () => ({ status: 401 }) });
    expect(byId((await runT2(refused, "local", null)).cases, "e")).toEqual({
      id: "e",
      result: "fail",
      detail: { status: 401 },
    });
  });

  it("f: Storage 200 with bytes for the console token fails; a listed object fails too", async () => {
    const download = makeDeps({
      storage: async (token, op) =>
        op === "download"
          ? { status: 200, code: null, count: null, bytes: 12 }
          : { status: 200, code: null, count: token === OWNER_TOKEN ? 1 : 0, bytes: null },
    });
    expect(byId((await runT2(download, "local", null)).cases, "f")?.result).toBe("fail");
    const listed = makeDeps({
      storage: async (_t, op) =>
        op === "list"
          ? { status: 200, code: null, count: 1, bytes: null }
          : { status: 400, code: "not_found", count: null, bytes: null },
    });
    // the owner control also lists one, so the control passes; the console token listing one is the leak
    const result = await runT2(listed, "local", null);
    expect(byId(result.cases, "f")?.result).toBe("fail");
  });

  it("f: records the status and error code of the console's denied download; control failing makes f inconclusive", async () => {
    const { cases } = await runT2(makeDeps(), "local", null);
    expect(byId(cases, "f")?.detail).toMatchObject({
      consoleDownloadStatus: 400,
      consoleDownloadCode: "not_found",
      ownerListStatus: 200,
    });
    const noControl = makeDeps({
      storage: async () => ({ status: 500, code: "boom", count: null, bytes: null }),
    });
    expect(byId((await runT2(noControl, "local", null)).cases, "f")).toMatchObject({
      result: "inconclusive",
      detail: { reason: "owner control failed" },
    });
  });

  // Payload shapes as shapeOf returns them: key paths that carry a value, never the values.
  const ROW: PayloadShape = {
    eventType: "INSERT",
    table: "sp0_rt_probe",
    commitTimestamp: true,
    valued: { new: ["id", "note", "tenant_id"], old: [], record: [] },
    errors: [],
  };
  const REFUSAL: PayloadShape = {
    eventType: "INSERT",
    table: "sp0_rt_probe",
    commitTimestamp: true,
    valued: { new: [], old: [], record: [] },
    errors: ["Error 401: Unauthorized"],
  };
  const realtime = (answer: Partial<RealtimeAnswer>) =>
    makeDeps({
      realtimeProbe: async ({ insert }) => {
        await insert();
        return {
          ownerJoin: "SUBSCRIBED",
          consoleJoin: "SUBSCRIBED",
          owner: [ROW],
          console: [],
          ...answer,
        };
      },
    });
  const g = async (answer: Partial<RealtimeAnswer>) =>
    byId((await runT2(realtime(answer), "local", null)).cases, "g");

  it("g: a probe-row value reaching the console fails", async () => {
    expect(await g({ console: [ROW] })).toMatchObject({ result: "fail" });
  });

  it("g: a single probe column with a value in any section fails, even beside an error", async () => {
    for (const valued of [
      { new: ["tenant_id"], old: [], record: [] },
      { new: [], old: ["id"], record: [] },
      { new: [], old: [], record: ["note"] },
    ]) {
      expect(await g({ console: [{ ...REFUSAL, valued }] })).toMatchObject({ result: "fail" });
    }
  });

  it("g: an explicit 401/Unauthorized refusal with no row columns passes and records the metadata finding", async () => {
    expect(await g({ console: [REFUSAL] })).toMatchObject({
      result: "pass",
      detail: { consoleRefusals: 1, console: [shapeText(REFUSAL)], owner: [shapeText(ROW)] },
    });
  });

  it("g: a console message that is neither row data nor an explicit refusal is inconclusive, with its shape", async () => {
    const other: PayloadShape = { ...REFUSAL, errors: ["Error 500: boom"] };
    const empty: PayloadShape = { ...REFUSAL, errors: [] };
    for (const shape of [other, empty]) {
      expect(await g({ console: [shape] })).toMatchObject({
        result: "inconclusive",
        detail: {
          reason: "console got a message that is neither row data nor an explicit refusal",
          console: [shapeText(shape)],
        },
      });
    }
  });

  it("g: no console message at all, with the owner control receiving the row, passes", async () => {
    expect(await g({ console: [] })).toMatchObject({
      result: "pass",
      detail: { consoleRefusals: 0 },
    });
  });

  it("g: a console join error is recorded and is not a leak", async () => {
    expect(await g({ consoleJoin: "CHANNEL_ERROR" })).toMatchObject({
      result: "pass",
      detail: { consoleJoin: "CHANNEL_ERROR" },
    });
  });

  it("g: an owner control channel that never subscribed is inconclusive, naming its status", async () => {
    expect(await g({ ownerJoin: "TIMED_OUT", owner: [] })).toMatchObject({
      result: "inconclusive",
      detail: { reason: "owner control did not subscribe", ownerJoin: "TIMED_OUT" },
    });
  });

  it("g: an owner control that got no row data is inconclusive", async () => {
    expect(await g({ owner: [REFUSAL] })).toMatchObject({
      result: "inconclusive",
      detail: { reason: "owner control received nothing" },
    });
  });

  it("g: records how many inserts the probe made", async () => {
    const deps = makeDeps({
      realtimeProbe: async ({ insert }) => {
        await insert();
        await insert();
        await insert();
        return { ownerJoin: "SUBSCRIBED", consoleJoin: "SUBSCRIBED", owner: [ROW], console: [] };
      },
    });
    expect(byId((await runT2(deps, "local", null)).cases, "g")).toMatchObject({
      result: "pass",
      detail: { inserts: 3 },
    });
  });

  it("g: a failed insert on any attempt makes g inconclusive with its status, even if a later one succeeds", async () => {
    let n = 0;
    const deps = makeDeps({
      rest: async (_token, _m, path) =>
        path.includes("sp0_rt_probe")
          ? (n += 1) === 1
            ? { status: 503, code: null, body: null }
            : { status: 201, code: null, body: null }
          : path.includes("sp0_platform_ping")
            ? {
                status: 200,
                code: null,
                body: { current_user: "platform_staff", tenant_claim: false },
              }
            : { status: 204, code: null, body: null },
      realtimeProbe: async ({ insert }) => {
        await insert();
        await insert();
        return { ownerJoin: "SUBSCRIBED", consoleJoin: "SUBSCRIBED", owner: [ROW], console: [] };
      },
    });
    expect(byId((await runT2(deps, "local", null)).cases, "g")).toMatchObject({
      result: "inconclusive",
      detail: { reason: "probe insert failed", status: 503 },
    });
  });

  // Code review pass 4 / lead 2026-11-14: a leak is graded before an insert failure, and an inconclusive keeps the evidence.
  const failingSecondInsert = (answer: Partial<RealtimeAnswer>) => {
    let n = 0;
    return makeDeps({
      rest: async (_token, _m, path) =>
        path.includes("sp0_rt_probe")
          ? (n += 1) === 1
            ? { status: 201, code: null, body: null }
            : { status: 503, code: null, body: null }
          : path.includes("sp0_platform_ping")
            ? {
                status: 200,
                code: null,
                body: { current_user: "platform_staff", tenant_claim: false },
              }
            : { status: 204, code: null, body: null },
      realtimeProbe: async ({ insert }) => {
        await insert();
        await insert();
        return {
          ownerJoin: "SUBSCRIBED",
          consoleJoin: "SUBSCRIBED",
          owner: [],
          console: [],
          ...answer,
        };
      },
    });
  };

  it("g: row data reaching the console fails even when a later insert failed", async () => {
    const deps = failingSecondInsert({ console: [ROW] });
    expect(byId((await runT2(deps, "local", null)).cases, "g")).toMatchObject({
      result: "fail",
      detail: { console: [shapeText(ROW)] },
    });
  });

  it("g: a failed insert is inconclusive and keeps both subscribers' shapes", async () => {
    const deps = failingSecondInsert({ console: [REFUSAL] });
    expect(byId((await runT2(deps, "local", null)).cases, "g")).toEqual({
      id: "g",
      result: "inconclusive",
      detail: {
        reason: "probe insert failed",
        status: 503,
        ownerJoin: "SUBSCRIBED",
        consoleJoin: "SUBSCRIBED",
        owner: [],
        console: [shapeText(REFUSAL)],
        consoleRefusals: 1,
        inserts: 2,
      },
    });
  });

  it("g: a failed probe insert makes g inconclusive with the status", async () => {
    const deps = makeDeps({
      rest: async (token, _m, path) =>
        path.includes("sp0_rt_probe")
          ? { status: 403, code: "42501", body: null }
          : path.includes("sp0_platform_ping")
            ? {
                status: 200,
                code: null,
                body: { current_user: "platform_staff", tenant_claim: false },
              }
            : { status: 204, code: null, body: null },
    });
    expect(byId((await runT2(deps, "local", null)).cases, "g")).toMatchObject({
      result: "inconclusive",
      detail: { reason: "probe insert failed", status: 403 },
    });
  });

  it("a failed preflight runs nothing and every case is inconclusive; hosted needs the preflight", async () => {
    const deps = makeDeps();
    const failed: CaseReport = {
      id: "preflight",
      result: "inconclusive",
      detail: { status: 403, reason: "secret key not injected" },
    };
    const { cases } = await runT2(deps, "temp", failed);
    expect(results(cases)).toEqual(
      ["a", "b", "c", "d", "e", "f", "g"].map((id) => [id, "inconclusive"]),
    );
    for (const fn of Object.values(deps)) expect(fn).not.toHaveBeenCalled();
    await expect(runT2(makeDeps(), "temp", null)).rejects.toThrow(/preflight/);
    expect(results((await runT2(makeDeps(), "temp", PREFLIGHT_OK)).cases)[0]).toEqual([
      "a",
      "pass",
    ]);
  });

  it("a thrown error is inconclusive with the error name only", async () => {
    const deps = makeDeps({
      rest: async (_t, _m, path) => {
        if (path.includes("sp0_platform_ping"))
          throw new TypeError("fetch failed https://x.supabase.co");
        return { status: 204, code: null, body: null };
      },
    });
    expect(byId((await runT2(deps, "local", null)).cases, "b")).toEqual({
      id: "b",
      result: "inconclusive",
      detail: { reason: "request failed", error: "TypeError" },
    });
  });

  it("a failing setup (tenant, password or owner sign-in) makes every case inconclusive, naming the step", async () => {
    const tenant = await runT2(
      makeDeps({
        createTenant: async () => {
          throw new Error("x");
        },
      }),
      "local",
      null,
    );
    expect(results(tenant.cases)).toEqual(
      ["a", "b", "c", "d", "e", "f", "g"].map((id) => [id, "inconclusive"]),
    );
    expect(byId(tenant.cases, "a")?.detail).toEqual({
      reason: "setup failed: tenant",
      error: "Error",
    });
    const password = await runT2(
      makeDeps({ setOwnerPassword: async () => ({ error: { message: "no" } }) }),
      "local",
      null,
    );
    expect(byId(password.cases, "a")?.detail).toEqual({ reason: "setup failed: password" });
    const signin = await runT2(
      makeDeps({
        passwordSignIn: async () => ({ status: 400, code: "invalid_credentials", session: null }),
      }),
      "local",
      null,
    );
    expect(byId(signin.cases, "a")?.detail).toEqual({ reason: "setup failed: owner sign-in" });
  });

  it("puts no token, address, URL or object path into any case", async () => {
    const { cases } = await runT2(makeDeps(), "local", null);
    expect(JSON.stringify(cases)).not.toMatch(/@|https?:|eyJ|\.pdf|1998/);
  });

  it("a 429 from Auth on the refresh into the console (a) or out of it (d) is inconclusive, not a fail", async () => {
    const limited = { status: 429, code: "over_request_rate_limit", session: null };
    const intoConsole = makeDeps({ refresh: async () => limited });
    const first = await runT2(intoConsole, "local", null);
    expect(byId(first.cases, "a")).toEqual({
      id: "a",
      result: "inconclusive",
      detail: { status: 429, code: "over_request_rate_limit" },
    });
    const refreshes = [session(CONSOLE_TOKEN, "r-2"), limited];
    const outOfConsole = makeDeps({
      refresh: async () => refreshes.shift() ?? limited,
    });
    const second = await runT2(outOfConsole, "local", null);
    expect(byId(second.cases, "a")?.result).toBe("pass");
    expect(byId(second.cases, "d")).toEqual({
      id: "d",
      result: "inconclusive",
      detail: { status: 429, code: "over_request_rate_limit" },
    });
  });

  it("e signs out with a token whose role is platform_staff, and fails without calling it if the refresh gave another role", async () => {
    const refreshes = [
      session(CONSOLE_TOKEN, "r-2"),
      session(BACK_TOKEN, "r-3"),
      session(BACK_TOKEN, "r-4"),
    ];
    const deps = makeDeps({
      refresh: async () => refreshes.shift() ?? { status: 500, code: null, session: null },
    });
    const { cases } = await runT2(deps, "local", null);
    expect(byId(cases, "e")).toEqual({
      id: "e",
      result: "fail",
      detail: {
        reason: "the token to sign out with is not a console token",
        role: "authenticated",
      },
    });
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  it("a setup call that throws after the tenant exists keeps the owner in the cleanup counts", async () => {
    const deps = makeDeps({
      passwordSignIn: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const crash = await runT2(deps, "local", null).catch((e: unknown) => e);
    expect(crash).toBeInstanceOf(CheckCrash);
    expect((crash as CheckCrash).partial).toEqual({
      cases: [],
      cleanup: { created: 1, deleted: 0, kept: 1 },
    });
  });

  it("e: a 429 on the sign-out is inconclusive with the status, any other non-2xx is a fail", async () => {
    const limited = makeDeps({ signOut: async () => ({ status: 429 }) });
    expect(byId((await runT2(limited, "local", null)).cases, "e")).toEqual({
      id: "e",
      result: "inconclusive",
      detail: { status: 429 },
    });
    const broken = makeDeps({ signOut: async () => ({ status: 500 }) });
    expect(byId((await runT2(broken, "local", null)).cases, "e")).toEqual({
      id: "e",
      result: "fail",
      detail: { status: 500 },
    });
  });
});

describe("shapeOf: a Realtime payload's shape, never its values", () => {
  it("shapeText renders one line with the key paths and errors", () => {
    expect(
      shapeText({
        eventType: "INSERT",
        table: "sp0_rt_probe",
        commitTimestamp: true,
        valued: { new: [], old: [], record: [] },
        errors: ["Error 401: Unauthorized"],
      }),
    ).toBe("INSERT sp0_rt_probe ts new[] old[] record[] errors[Error 401: Unauthorized]");
  });

  it("lists the keys that carry a value per section, sorted, and the error texts", () => {
    expect(
      shapeOf({
        eventType: "INSERT",
        table: "sp0_rt_probe",
        commit_timestamp: "1998-10-03T10:00:00Z",
        new: { tenant_id: "secret-tenant", note: "sp0", id: 7, empty: null },
        old: {},
        errors: ["Error 401: Unauthorized", 5],
      }),
    ).toEqual({
      eventType: "INSERT",
      table: "sp0_rt_probe",
      commitTimestamp: true,
      valued: { new: ["id", "note", "tenant_id"], old: [], record: [] },
      errors: ["Error 401: Unauthorized"],
    });
  });

  it("never copies a value", () => {
    const shape = shapeOf({ new: { tenant_id: "secret-tenant" }, record: { note: "secret-note" } });
    expect(JSON.stringify(shape)).not.toMatch(/secret/);
    expect(shape.valued.record).toEqual(["note"]);
  });

  it("handles a payload with nothing in it", () => {
    expect(shapeOf(null)).toEqual({
      eventType: null,
      table: null,
      commitTimestamp: false,
      valued: { new: [], old: [], record: [] },
      errors: [],
    });
  });
});
