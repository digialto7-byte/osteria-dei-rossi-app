import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// SP3 round 2, item D. A job that names `environment: platform-ops` before the founder has created the environment makes GitHub create it with no protection
// rules and no secrets: every secret then arrives as an empty string. Each script the workflow runs must stop on its own, before any Supabase call, when its
// Supabase settings are empty. These run the real entry scripts (npx tsx, as the workflow does) with the settings empty.
const ID_A = "ae100000-0000-4000-8000-0000000000ae";
const ID_B = "ad100000-0000-4000-8000-0000000000ad";
const EMPTY_SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  SUPABASE_SECRET_KEY: "",
};
const TENANT_DATA = {
  TENANT_NAME: "Osteria Demo",
  TENANT_VAT_NUMBER: "IT00000000000",
  OWNER_EMAIL: "owner@example.test",
  OWNER_NAME: "Titolare Demo",
};

function run(script: string, args: string[], env: Record<string, string>) {
  const result = spawnSync("npx", ["tsx", `scripts/${script}`, ...args], {
    cwd: new URL("../../", import.meta.url).pathname,
    // Nothing reachable: a call that was attempted would fail with a network error, which the assertions below forbid.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test", ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

const SETTINGS =
  /NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY/;
const NETWORK = /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|getaddrinfo/i;

describe("the platform-ops scripts fail closed when their Supabase settings are empty", () => {
  it("mfa-reset (with --yes, as the workflow runs it) stops with a configuration error and prints nothing to stdout", () => {
    const r = run("mfa-reset.ts", ["--user", ID_A, "--actor", ID_B, "--yes"], EMPTY_SUPABASE);
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(SETTINGS);
    expect(r.err).not.toMatch(NETWORK);
    expect(r.out).toBe("");
  });

  it("set-mfa-enforcement stops with a configuration error and prints nothing to stdout", () => {
    const r = run(
      "set-mfa-enforcement.ts",
      ["--tenant", ID_A, "--mode", "off", "--actor", ID_B],
      EMPTY_SUPABASE,
    );
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(SETTINGS);
    expect(r.err).not.toMatch(NETWORK);
    expect(r.out).toBe("");
  });

  it("create-tenant (its four values set) stops with a configuration error, prints no id and none of its data", () => {
    const r = run("create-tenant.ts", [], { ...EMPTY_SUPABASE, ...TENANT_DATA });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(SETTINGS);
    expect(r.err).not.toMatch(NETWORK);
    expect(r.out).toBe("");
    for (const value of Object.values(TENANT_DATA)) expect(r.err).not.toContain(value);
  });

  it("create-tenant with its four values empty (the environment missing) names them and never reaches Supabase", () => {
    const r = run("create-tenant.ts", [], {
      ...EMPTY_SUPABASE,
      TENANT_NAME: "",
      TENANT_VAT_NUMBER: "",
      OWNER_EMAIL: "",
      OWNER_NAME: "",
    });
    expect(r.status).toBe(1);
    for (const name of Object.keys(TENANT_DATA)) expect(r.err).toContain(name);
    expect(r.err).not.toMatch(SETTINGS);
    expect(r.out).toBe("");
  });
});
