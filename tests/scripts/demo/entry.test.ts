import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The supabase-js client is replaced, so the test sees every client the entry point creates.
const created: { url: string; key: string }[] = [];
const rpcAnswers: Record<string, unknown> = {};
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((url: string, key: string) => {
    created.push({ url, key });
    return {
      rpc: vi.fn(async (name: string) => ({ data: rpcAnswers[name] ?? null, error: null })),
      auth: { admin: {}, signOut: vi.fn() },
      storage: { from: vi.fn() },
    };
  }),
}));

import { main, type MainIo } from "../../../scripts/lib/demo/main";

const STAGING = "https://wjowhjsfpcdykxwgjipq.supabase.co";
const SECRET = "test-key-do-not-print";
const PUBLISHABLE = "test-publishable-key";
/** A fake tenant id. The real tenant's id is never in the repository. */
const TENANT = "11111111-1111-4111-8111-111111111111";
const LOCAL = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };

function run(env: Record<string, string>, argv: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const io: MainIo = {
    argv,
    env: {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      SUPABASE_SECRET_KEY: SECRET,
      ...env,
    },
    now: () => new Date("2026-10-24T18:00:00Z"),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
  return main(io).then((code) => ({ code, out, err }));
}

beforeEach(() => {
  created.length = 0;
  for (const key of Object.keys(rpcAnswers)) delete rpcAnswers[key];
});

describe("the entry point resolves the target before it creates any client", () => {
  it("a hosted URL without --target staging exits 1 and creates no client", async () => {
    const result = await run({ NEXT_PUBLIC_SUPABASE_URL: STAGING, DEMO_STAGING_OK: "yes" }, [
      "--tenant",
      TENANT,
    ]);
    expect(result.code).toBe(1);
    expect(created).toEqual([]);
  });

  it("staging without the opt-in exits 1 and creates no client", async () => {
    const result = await run({ NEXT_PUBLIC_SUPABASE_URL: STAGING }, [
      "--target",
      "staging",
      "--tenant",
      TENANT,
    ]);
    expect(result.code).toBe(1);
    expect(created).toEqual([]);
    expect(result.err.join("\n")).toContain("DEMO_STAGING_OK");
  });

  it("staging with the opt-in but another project's URL exits 1 and creates no client", async () => {
    const result = await run(
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
        DEMO_STAGING_OK: "yes",
      },
      ["--target", "staging", "--tenant", TENANT],
    );
    expect(result.code).toBe(1);
    expect(created).toEqual([]);
  });

  it("a seed without --tenant exits 1 and creates no client", async () => {
    const result = await run(LOCAL);
    expect(result.code).toBe(1);
    expect(created).toEqual([]);
    expect(result.err.join("\n")).toContain("--tenant");
  });

  it("an invalid tenant is refused without echoing it and creates no client", async () => {
    const result = await run(LOCAL, ["--tenant", "secret-looking-value"]);
    expect(result.code).toBe(1);
    expect(created).toEqual([]);
    expect(result.err.join("\n")).not.toContain("secret-looking-value");
  });

  it("staging needs no owner address: the demo owner is a fake on a reserved domain", async () => {
    rpcAnswers.demo_tenant_state = { exists: false };
    const result = await run({ NEXT_PUBLIC_SUPABASE_URL: STAGING, DEMO_STAGING_OK: "yes" }, [
      "--target",
      "staging",
      "--tenant",
      TENANT,
    ]);
    expect(result.err.join("\n")).not.toContain("DEMO_OWNER_EMAIL");
    expect(JSON.parse(result.out[0]!)).toMatchObject({
      target: "staging",
      error: "tenant_not_found",
    });
  });

  it("a missing key is a configuration error that names the variable only", async () => {
    const result = await run(
      { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SECRET_KEY: "" },
      ["--tenant", TENANT],
    );
    expect(result.code).toBe(1);
    expect(created).toEqual([]);
    expect(result.err.join("\n")).toContain("SUPABASE_SECRET_KEY");
  });

  it("no refusal prints the URL or a key", async () => {
    const result = await run({ NEXT_PUBLIC_SUPABASE_URL: STAGING }, ["--tenant", TENANT]);
    const text = [...result.out, ...result.err].join("\n");
    expect(text).not.toContain("supabase.co");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PUBLISHABLE);
  });
});

describe("the exit code follows the report", () => {
  it("a local run that is refused by the demo data already there exits 1 with one JSON line", async () => {
    rpcAnswers.demo_tenant_state = {
      exists: true,
      tenantId: TENANT,
      name: "Locale Prova (demo)",
      demoSince: "2026-10-20T10:00:00Z",
      hasOperationalData: true,
      demoUsers: 6,
    };
    const result = await run(LOCAL, ["--tenant", TENANT]);
    expect(result.code).toBe(1);
    expect(created.length).toBeGreaterThan(0);
    expect(result.out).toHaveLength(1);
    const report = JSON.parse(result.out[0]!) as Record<string, unknown>;
    expect(report).toMatchObject({
      target: "local",
      mode: "seed",
      ok: false,
      error: "demo_exists_use_reset",
    });
    const text = [...result.out, ...result.err].join("\n");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PUBLISHABLE);
    // The tenant's name and id are client facts: the name is used for the confirmation, neither is ever printed.
    expect(text).not.toContain("Locale Prova");
    expect(text).not.toContain(TENANT);
  });

  it("an unmarked tenant that holds data exits 1 and nothing is written", async () => {
    rpcAnswers.demo_tenant_state = {
      exists: true,
      tenantId: TENANT,
      name: "Locale Prova (demo)",
      demoSince: null,
      hasOperationalData: true,
      demoUsers: 0,
    };
    const result = await run(LOCAL, ["--tenant", TENANT]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out[0]!)).toMatchObject({
      ok: false,
      error: "tenant_has_operational_data",
    });
  });

  it("--cleanup with nothing pending exits 0 and reports counts", async () => {
    rpcAnswers.demo_purge_pending = [];
    const result = await run({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, ["--cleanup"]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out[0]!) as { mode: string; ok: boolean; counts: object };
    expect(report).toMatchObject({ mode: "cleanup", ok: true });
    expect(report.counts).toMatchObject({ cleaned: 0, failed: 0 });
  });

  it("--purge on a tenant without demo data and nothing pending exits 0", async () => {
    rpcAnswers.demo_tenant_state = { exists: true, tenantId: TENANT, name: "x", demoSince: null };
    rpcAnswers.demo_purge_pending = [];
    const result = await run(LOCAL, ["--purge", "--tenant", TENANT]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!)).toMatchObject({ mode: "purge", ok: true });
  });

  it("an unexpected error exits 1 with a generic message", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw new Error(`boom with ${SECRET}`);
    });
    const result = await run(LOCAL, ["--tenant", TENANT]);
    expect(result.code).toBe(1);
    expect([...result.out, ...result.err].join("\n")).not.toContain(SECRET);
  });
});

describe("wiring", () => {
  it("the npm script runs the entry file", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.demo).toBe("tsx scripts/demo/seed-demo.ts");
  });

  it(".env.example holds no demo setting: no owner address, no opt-in, no tenant", () => {
    const env = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    expect(env).not.toMatch(/DEMO_/);
  });

  it("the entry file only calls main and sets the exit code", () => {
    const entry = readFileSync(
      new URL("../../../scripts/demo/seed-demo.ts", import.meta.url),
      "utf8",
    );
    expect(entry).toContain("main(");
    expect(entry).not.toMatch(/createClient|SUPABASE_SECRET_KEY/);
  });
});
