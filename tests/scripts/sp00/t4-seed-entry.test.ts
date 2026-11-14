import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { STAGING_PROJECT_REF } from "../../../scripts/lib/demo/target";
import type { CaseReport } from "../../../scripts/lib/sp00/report";
import type { T4SeedResult } from "../../../scripts/lib/sp00/t4-seed";
import {
  parseSeedArgs,
  runT4SeedEntry,
  type SeedContext,
  type SeedEntryIo,
} from "../../../scripts/lib/sp00/t4-seed-entry";

const REF = "abcdefghijklmnopqrst";
const LOCAL_ENV = { SPIKE_SUPABASE_URL: "http://127.0.0.1:54321" };
const TEMP_ENV = {
  SPIKE_SUPABASE_URL: `https://${REF}.supabase.co`,
  SPIKE_TEMP_OK: "yes",
  SPIKE_PROJECT_REF: REF,
};
const OK: T4SeedResult = {
  ok: true,
  tenantId: "11111111-1111-4111-8111-111111111111",
  counts: { suppliers: 3 },
  steps: [{ id: "fire", ok: true }],
};

function makeIo(argv: string[], env: Record<string, string>, overrides: Partial<SeedContext> = {}) {
  const context: SeedContext = {
    secrets: ["placeholder-not-a-key"],
    preflight: vi.fn(async (): Promise<CaseReport> => ({
      id: "preflight",
      result: "pass",
      detail: { status: 200 },
    })),
    seed: vi.fn(async (_pre: CaseReport | null) => OK),
    ...overrides,
  };
  const lines: string[] = [];
  const errors: string[] = [];
  const buildContext = vi.fn(() => context);
  const io: SeedEntryIo = {
    argv,
    env,
    buildContext,
    print: (l) => lines.push(l),
    printError: (m) => errors.push(m),
  };
  return { io, lines, errors, buildContext, context };
}

describe("parseSeedArgs", () => {
  it("requires --target local or temp and nothing else", () => {
    expect(() => parseSeedArgs([])).toThrow(/--target/);
    expect(() => parseSeedArgs(["--target", "staging"])).toThrow(/local or temp/);
    expect(() => parseSeedArgs(["--target", "local", "--x"])).toThrow();
    expect(parseSeedArgs(["--target", "temp"])).toEqual({ target: "temp" });
  });
});

describe("runT4SeedEntry", () => {
  it("refuses before any client: a bad target, the staging project by name", async () => {
    const bad = makeIo(["--target", "temp"], { ...TEMP_ENV, SPIKE_TEMP_OK: "no" });
    expect(await runT4SeedEntry(bad.io)).toBe(1);
    expect(bad.buildContext).not.toHaveBeenCalled();
    const staging = makeIo(["--target", "temp"], {
      SPIKE_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
      SPIKE_TEMP_OK: "yes",
      SPIKE_PROJECT_REF: STAGING_PROJECT_REF,
    });
    expect(await runT4SeedEntry(staging.io)).toBe(1);
    expect(staging.buildContext).not.toHaveBeenCalled();
    expect(staging.errors.join()).toMatch(/staging project/);
    expect(staging.lines).toEqual([]);
  });

  it("local: no preflight; prints one JSON line with the tenant id; exit 0", async () => {
    const { io, lines, context } = makeIo(["--target", "local"], LOCAL_ENV);
    expect(await runT4SeedEntry(io)).toBe(0);
    expect(context.preflight).not.toHaveBeenCalled();
    expect(vi.mocked(context.seed).mock.calls[0]?.[0]).toBeNull();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      check: "t4-seed",
      target: "local",
      ok: true,
      tenantId: OK.tenantId,
    });
  });

  it("temp: the preflight runs first and its result goes to the seed", async () => {
    const { io, context } = makeIo(["--target", "temp"], TEMP_ENV);
    expect(await runT4SeedEntry(io)).toBe(0);
    const order = [
      vi.mocked(context.preflight).mock.invocationCallOrder[0],
      vi.mocked(context.seed).mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1] ?? 0);
    expect((vi.mocked(context.seed).mock.calls[0]?.[0] as CaseReport).id).toBe("preflight");
  });

  it("a failed result prints its line and exits 1", async () => {
    const { io, lines } = makeIo(["--target", "local"], LOCAL_ENV, {
      seed: vi.fn(async () => ({ ...OK, ok: false, error: "seed failed" })),
    });
    expect(await runT4SeedEntry(io)).toBe(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ ok: false, error: "seed failed" });
  });

  it("a crash is reported by the error name only, exit 1", async () => {
    const { io, errors, lines } = makeIo(["--target", "local"], LOCAL_ENV, {
      seed: vi.fn(async () => {
        throw new RangeError("boom https://x.supabase.co");
      }),
    });
    expect(await runT4SeedEntry(io)).toBe(1);
    expect(lines).toEqual([]);
    expect(errors.join()).toContain("RangeError");
    expect(errors.join()).not.toContain("supabase.co");
  });

  it("a result that would leak is not printed", async () => {
    const { io, lines, errors } = makeIo(["--target", "local"], LOCAL_ENV, {
      seed: vi.fn(async () => ({ ...OK, error: "x@example.test" })),
    });
    expect(await runT4SeedEntry(io)).toBe(1);
    expect(lines).toEqual([]);
    expect(errors.join()).toMatch(/Report refused/);
  });
});

describe("scripts/spike/sp00-t4-seed.ts (run as the lead runs it)", () => {
  it("refuses the staging project by name before it builds a client", () => {
    const result = spawnSync("npx", ["tsx", "scripts/spike/sp00-t4-seed.ts", "--target", "temp"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "test",
        SPIKE_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
        SPIKE_TEMP_OK: "yes",
        SPIKE_PROJECT_REF: STAGING_PROJECT_REF,
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/staging project/);
  });
});
