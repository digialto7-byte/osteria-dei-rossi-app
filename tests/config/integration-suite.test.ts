import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import integrationConfig from "../../vitest.integration.config";
import unitConfig from "../../vitest.config";

// The real-stack suite needs Supabase (Auth, PostgREST, Storage), so it must never run in
// `npm test` and must run in the CI job that starts the stack.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("integration suite wiring", () => {
  it("npm test (unit config) does not pick up *.int.ts files", () => {
    const include = unitConfig.test?.include ?? [];
    expect(include).toEqual(["tests/**/*.test.ts"]);
  });

  it("the integration config runs only tests/integration/**/*.int.ts", () => {
    expect(integrationConfig.test?.include).toEqual(["tests/integration/**/*.int.ts"]);
  });

  it("has a test:integration script that uses the integration config", () => {
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(scripts["test:integration"]).toBe("vitest run --config vitest.integration.config.ts");
    expect(scripts.test).toBe("vitest run");
  });

  it("tests/integration/** may use the secret key for fixtures", () => {
    const list = read("eslint.config.mjs").match(/SECRET_KEY_ALLOWED_FILES = \[([^\]]*)\]/)?.[1];
    expect(list).toContain('"tests/integration/**"');
  });

  it("CI runs it in the supabase job after the env export and before the build", () => {
    const ci = read(".github/workflows/ci.yml");
    const exportAt = ci.indexOf("Export local Supabase settings");
    const stepAt = ci.indexOf("npm run test:integration");
    const buildAt = ci.indexOf("npm run build");
    expect(exportAt).toBeGreaterThan(-1);
    expect(stepAt).toBeGreaterThan(exportAt);
    expect(buildAt).toBeGreaterThan(stepAt);
    // Exactly once, and not in the `checks` job (which has no Supabase stack).
    expect(ci.match(/npm run test:integration/g)).toHaveLength(1);
    expect(stepAt).toBeGreaterThan(ci.indexOf("  supabase:"));
  });

  // M11: the staff PIN suite derives passwords with the pepper and runs psql against the local stack.
  describe("staff PIN integration (M11)", () => {
    const ci = read(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("  supabase:"));

    it("the supabase job has a fake PIN_PEPPER in its env, long enough, and it is not a secret", () => {
      const pepper = /^\s+PIN_PEPPER:\s*(\S+)\s*$/m.exec(job)?.[1];
      expect(pepper).toBeDefined();
      expect(pepper!.length).toBeGreaterThanOrEqual(32);
      expect(pepper).toContain("test");
      expect(job).not.toMatch(/PIN_PEPPER:\s*\$\{\{\s*secrets\./);
      // The fake lives in the supabase job only, not in the job without a stack.
      expect(ci.slice(0, ci.indexOf("  supabase:"))).not.toContain("PIN_PEPPER");
    });

    it("checks psql is installed before the integration tests (installing it if missing)", () => {
      const check = job.indexOf("psql --version");
      expect(check).toBeGreaterThan(-1);
      expect(check).toBeLessThan(job.indexOf("npm run test:integration"));
      expect(job).toContain("postgresql-client");
    });

    it("the integration suite file and its helpers exist", () => {
      for (const path of [
        "tests/integration/staff-pin.int.ts",
        "tests/integration/helpers/sql.ts",
        "tests/integration/helpers/cookie-jar.ts",
      ]) {
        expect(() => read(path), path).not.toThrow();
      }
    });
  });
});
