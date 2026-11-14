import { spawnSync } from "node:child_process";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  parseAuthArgs,
  parseAuthVersion,
  readAuthVersion,
  runAuthEntry,
  type AuthContext,
  type EntryIo,
} from "../../../scripts/lib/sp00/auth-entry";
import { STAGING_PROJECT_REF } from "../../../scripts/lib/demo/target";
import type { CaseReport } from "../../../scripts/lib/sp00/report";

const REF = "abcdefghijklmnopqrst";
const SECRET = "placeholder-not-a-key";
const LOCAL_ENV = { SPIKE_SUPABASE_URL: "http://127.0.0.1:54321" };
const TEMP_ENV = {
  SPIKE_SUPABASE_URL: `https://${REF}.supabase.co`,
  SPIKE_TEMP_OK: "yes",
  SPIKE_PROJECT_REF: REF,
};
const OK_CASE: CaseReport = { id: "1", result: "pass", detail: {} };
const CLEANUP = { created: 0, deleted: 0, kept: 0 };

const callsOf = (fn: unknown) => (fn as Mock).mock.calls as unknown[][];

function makeContext(overrides: Partial<AuthContext> = {}) {
  const check = async (_pre: CaseReport | null) => ({ cases: [OK_CASE], cleanup: CLEANUP });
  const ctx = {
    secrets: [SECRET],
    preflight: vi.fn(async (): Promise<CaseReport> => ({
      id: "preflight",
      result: "pass",
      detail: { status: 200 },
    })),
    authVersion: vi.fn(async () => "v2.9.9"),
    checks: { t1: vi.fn(check), t2: vi.fn(check), t3: vi.fn(check), t5: vi.fn(check) },
    ...overrides,
  };
  return ctx;
}

function makeIo(argv: string[], env: Record<string, string>, ctx = makeContext()) {
  const lines: string[] = [];
  const errors: string[] = [];
  const buildContext = vi.fn((): AuthContext => ctx);
  const io: EntryIo = {
    argv,
    env,
    buildContext,
    print: (l) => lines.push(l),
    printError: (m) => errors.push(m),
  };
  return { io, lines, errors, buildContext, ctx };
}

describe("parseAuthArgs", () => {
  it("requires --target local or temp", () => {
    expect(() => parseAuthArgs([])).toThrow(/--target/);
    expect(() => parseAuthArgs(["--target", "staging"])).toThrow(/local or temp/);
  });

  it("local default: t5, t1, t2, t3 in that order, no preflight", () => {
    expect(parseAuthArgs(["--target", "local"])).toEqual({
      target: "local",
      checks: ["t5", "t1", "t2", "t3"],
    });
  });

  it("temp default: preflight first, then t5, t1, t2, t3", () => {
    expect(parseAuthArgs(["--target", "temp"])).toEqual({
      target: "temp",
      checks: ["preflight", "t5", "t1", "t2", "t3"],
    });
  });

  it("a listed subset keeps the canonical order, and hosted always starts with the preflight", () => {
    expect(parseAuthArgs(["--target", "local", "--checks", "t3,t1"]).checks).toEqual(["t1", "t3"]);
    expect(parseAuthArgs(["--target", "temp", "--checks", "t2"]).checks).toEqual([
      "preflight",
      "t2",
    ]);
    expect(parseAuthArgs(["--target", "temp", "--checks", "preflight"]).checks).toEqual([
      "preflight",
    ]);
  });

  it("accepts only preflight, t1, t2, t3 and t5, and not twice, and no preflight on local", () => {
    expect(() => parseAuthArgs(["--target", "local", "--checks", "t4"])).toThrow(
      /--checks accepts only/,
    );
    expect(() => parseAuthArgs(["--target", "local", "--checks", "t1,t1"])).toThrow(
      /more than once/,
    );
    expect(() => parseAuthArgs(["--target", "local", "--checks", ""])).toThrow(
      /--checks accepts only/,
    );
    expect(() => parseAuthArgs(["--target", "local", "--checks", "preflight"])).toThrow(/hosted/);
    expect(() => parseAuthArgs(["--target", "local", "--nope"])).toThrow();
  });
});

describe("runAuthEntry: the guard comes first", () => {
  it("a refused target builds no client and prints no report", async () => {
    const { io, buildContext, errors, lines } = makeIo(["--target", "temp"], {
      ...TEMP_ENV,
      SPIKE_TEMP_OK: "no",
    });
    expect(await runAuthEntry(io)).toBe(1);
    expect(buildContext).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    expect(errors.join()).toMatch(/SPIKE_TEMP_OK/);
  });

  it("the staging project is refused by name before any client, with no STAGING_PROJECT_REF set", async () => {
    const env = {
      SPIKE_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
      SPIKE_TEMP_OK: "yes",
      SPIKE_PROJECT_REF: STAGING_PROJECT_REF,
    };
    const { io, buildContext, errors } = makeIo(["--target", "temp"], env);
    expect(await runAuthEntry(io)).toBe(1);
    expect(buildContext).not.toHaveBeenCalled();
    expect(errors.join()).toMatch(/staging project/);
    expect(errors.join()).not.toContain(STAGING_PROJECT_REF);
  });

  it("a hosted URL with --target local is refused before any client", async () => {
    const { io, buildContext } = makeIo(["--target", "local"], {
      SPIKE_SUPABASE_URL: TEMP_ENV.SPIKE_SUPABASE_URL,
    });
    expect(await runAuthEntry(io)).toBe(1);
    expect(buildContext).not.toHaveBeenCalled();
  });

  it("a missing URL is refused before any client", async () => {
    const { io, buildContext } = makeIo(["--target", "local"], {});
    expect(await runAuthEntry(io)).toBe(1);
    expect(buildContext).not.toHaveBeenCalled();
  });

  it("bad arguments are refused before the guard and any client", async () => {
    const { io, buildContext, errors } = makeIo(["--checks", "t1"], LOCAL_ENV);
    expect(await runAuthEntry(io)).toBe(1);
    expect(buildContext).not.toHaveBeenCalled();
    expect(errors.join()).toMatch(/--target/);
  });
});

describe("runAuthEntry: running the checks", () => {
  it("local: one JSON line per check in order, exit 0 when all pass, no preflight", async () => {
    const { io, lines, ctx } = makeIo(["--target", "local"], LOCAL_ENV);
    expect(await runAuthEntry(io)).toBe(0);
    const reports = lines.map(
      (l) => JSON.parse(l) as { target: string; check: string; ok: boolean; authVersion: string },
    );
    expect(reports.map((r) => r.check)).toEqual(["t5", "t1", "t2", "t3"]);
    expect(reports.every((r) => r.ok && r.target === "local" && r.authVersion === "v2.9.9")).toBe(
      true,
    );
    expect(ctx.preflight).not.toHaveBeenCalled();
    expect(callsOf(ctx.checks.t5)[0]?.[0]).toBeNull();
  });

  it("temp: the preflight runs first, is printed as a check, and its result is passed to every check", async () => {
    const { io, lines, ctx } = makeIo(["--target", "temp"], TEMP_ENV);
    expect(await runAuthEntry(io)).toBe(0);
    expect(lines.map((l) => (JSON.parse(l) as { check: string }).check)).toEqual([
      "preflight",
      "t5",
      "t1",
      "t2",
      "t3",
    ]);
    const passed = callsOf(ctx.checks.t1)[0]?.[0] as CaseReport | undefined;
    expect(passed?.id).toBe("preflight");
    expect(passed?.result).toBe("pass");
  });

  it("a failed preflight is passed on, so every key-needing check is reported not passed, and the exit is 1", async () => {
    const failed: CaseReport = {
      id: "preflight",
      result: "inconclusive",
      detail: { status: 401, reason: "secret key not injected" },
    };
    const inconclusive = async (pre: CaseReport | null) => ({
      cases:
        pre?.result === "pass"
          ? [OK_CASE]
          : [{ id: "1", result: "inconclusive" as const, detail: { reason: "preflight failed" } }],
      cleanup: CLEANUP,
    });
    const ctx = makeContext({
      preflight: vi.fn(async () => failed),
      checks: {
        t1: vi.fn(inconclusive),
        t2: vi.fn(inconclusive),
        t3: vi.fn(inconclusive),
        t5: vi.fn(inconclusive),
      },
    });
    const { io, lines } = makeIo(["--target", "temp"], TEMP_ENV, ctx);
    expect(await runAuthEntry(io)).toBe(1);
    const reports = lines.map(
      (l) => JSON.parse(l) as { check: string; ok: boolean; cases: { result: string }[] },
    );
    expect(reports.map((r) => r.ok)).toEqual([false, false, false, false, false]);
    expect(reports[1]?.cases[0]?.result).toBe("inconclusive");
  });

  it("exits 1 when any check fails, and still runs the rest", async () => {
    const failing = vi.fn(async () => ({
      cases: [{ id: "1", result: "fail" as const, detail: {} }],
      cleanup: CLEANUP,
    }));
    const ctx = makeContext();
    ctx.checks.t1 = failing;
    const { io, lines } = makeIo(["--target", "local"], LOCAL_ENV, ctx);
    expect(await runAuthEntry(io)).toBe(1);
    expect(lines).toHaveLength(4);
  });

  it("runs only the requested subset", async () => {
    const { io, lines, ctx } = makeIo(["--target", "local", "--checks", "t3"], LOCAL_ENV);
    await runAuthEntry(io);
    expect(lines).toHaveLength(1);
    expect(ctx.checks.t3).toHaveBeenCalledTimes(1);
    expect(ctx.checks.t1).not.toHaveBeenCalled();
  });

  it("a check that throws is reported as inconclusive with the error name, and the run goes on", async () => {
    const ctx = makeContext();
    ctx.checks.t5 = vi.fn(async () => {
      throw new RangeError("boom at https://x.supabase.co");
    });
    const { io, lines } = makeIo(["--target", "local"], LOCAL_ENV, ctx);
    expect(await runAuthEntry(io)).toBe(1);
    const first = JSON.parse(lines[0] ?? "") as {
      check: string;
      cases: { id: string; result: string; detail: Record<string, unknown> }[];
    };
    expect(first.check).toBe("t5");
    expect(first.cases).toEqual([
      {
        id: "run",
        result: "inconclusive",
        detail: { reason: "check crashed", error: "RangeError" },
      },
    ]);
    expect(lines).toHaveLength(4);
  });

  it("a report that would leak a value is not printed, the error is, and the exit is 1", async () => {
    const ctx = makeContext();
    ctx.checks.t5 = vi.fn(async () => ({
      cases: [{ id: "1", result: "pass" as const, detail: { note: `x ${SECRET}` } }],
      cleanup: CLEANUP,
    }));
    const { io, lines, errors } = makeIo(["--target", "local", "--checks", "t5"], LOCAL_ENV, ctx);
    expect(await runAuthEntry(io)).toBe(1);
    expect(lines).toEqual([]);
    expect(errors.join()).toMatch(/Report refused/);
    expect(errors.join()).not.toContain(SECRET);
  });

  it("Auth that cannot be read for its version stops the run before any check", async () => {
    const ctx = makeContext({
      authVersion: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    const { io, errors } = makeIo(["--target", "local"], LOCAL_ENV, ctx);
    expect(await runAuthEntry(io)).toBe(1);
    expect(ctx.checks.t5).not.toHaveBeenCalled();
    expect(errors.join()).toMatch(/Auth/);
  });

  it("records 'unknown' when the context has no version", async () => {
    const ctx = makeContext({ authVersion: vi.fn(async () => null) });
    const { io, lines } = makeIo(["--target", "local", "--checks", "t5"], LOCAL_ENV, ctx);
    await runAuthEntry(io);
    expect((JSON.parse(lines[0] ?? "") as { authVersion: string }).authVersion).toBe("unknown");
  });
});

describe("the Auth version from /auth/v1/health", () => {
  it("is read from the version field when it looks like a version, else null", () => {
    expect(parseAuthVersion({ version: "v2.180.0", name: "GoTrue" })).toBe("v2.180.0");
    expect(parseAuthVersion({ name: "GoTrue" })).toBeNull();
    expect(parseAuthVersion({ version: "x y@z" })).toBeNull();
    expect(parseAuthVersion({ version: 5 })).toBeNull();
    expect(parseAuthVersion(null)).toBeNull();
    expect(parseAuthVersion("v1")).toBeNull();
  });

  it("readAuthVersion asks the health endpoint with the publishable key and returns null for a non-200 answer", async () => {
    const seen: { url: string; key: string | null }[] = [];
    const answer = (status: number, body: unknown) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), key: new Headers(init?.headers).get("apikey") });
        return new Response(JSON.stringify(body), { status });
      }) as typeof fetch;
    expect(await readAuthVersion(answer(200, { version: "v2.1.0" }), "http://x", "pub")).toBe(
      "v2.1.0",
    );
    expect(seen[0]).toEqual({ url: "http://x/auth/v1/health", key: "pub" });
    expect(await readAuthVersion(answer(404, {}), "http://x", "pub")).toBeNull();
    expect(await readAuthVersion(answer(200, "not an object"), "http://x", "pub")).toBeNull();
  });
});

describe("scripts/spike/sp00-auth.ts (run as the lead runs it)", () => {
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync("npx", ["tsx", "scripts/spike/sp00-auth.ts", ...args], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test", ...env },
      encoding: "utf8",
    });

  it("refuses the staging project by name before it builds a client, with no STAGING_PROJECT_REF set", () => {
    const result = run(["--target", "temp"], {
      SPIKE_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
      SPIKE_TEMP_OK: "yes",
      SPIKE_PROJECT_REF: STAGING_PROJECT_REF,
      SPIKE_PUBLISHABLE_KEY: "test-publishable-key",
      SPIKE_SECRET_KEY: SECRET,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/staging project/);
    expect(result.stderr).not.toContain(STAGING_PROJECT_REF);
    expect(result.stderr).not.toContain(SECRET);
  });

  it("needs --target", () => {
    const result = run([], { SPIKE_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--target/);
  });
});
