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

    it("runs the T1 spike in its own job on a fresh stack, so no other sign-ins share its 30-per-5-min budget", () => {
      // GoTrue's sign_in_sign_ups bucket is per IP and refills slowly: Playwright's PIN logins in the
      // supabase job would leave the spike a partial budget. Its own job starts with a full bucket.
      expect(ci.match(/scripts\/spike\/t1-staff-auth\.ts/g)).toHaveLength(1);
      expect(job.slice(0, job.indexOf("\n  t1-spike:"))).not.toContain("t1-staff-auth");
      const spikeJob = ci.slice(ci.indexOf("\n  t1-spike:"));
      expect(ci.indexOf("\n  t1-spike:")).toBeGreaterThan(-1);
      expect(spikeJob).toContain("npx supabase start");
      expect(spikeJob.indexOf("scripts/spike/t1-staff-auth.ts")).toBeGreaterThan(
        spikeJob.indexOf("npx supabase start"),
      );
      // The spike reads the stack settings from the job env: the export must come before it.
      const exportAt = spikeJob.indexOf('>> "$GITHUB_ENV"');
      expect(exportAt).toBeGreaterThan(spikeJob.indexOf("npx supabase start"));
      expect(exportAt).toBeLessThan(spikeJob.indexOf("scripts/spike/t1-staff-auth.ts"));
      for (const name of [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
        "E2E_MAILPIT_URL",
      ]) {
        expect(spikeJob.slice(0, exportAt)).toContain(`${name}=`);
      }
      for (const command of ["npm run test:integration", "npx playwright test", "npm run build"]) {
        expect(spikeJob).not.toContain(command);
      }
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

  // Reservations PR2 (B12, B13): the real-stack suite and the public e2e spec send e-mail through Mailpit and sign the route gate, so the supabase job carries fakes.
  describe("reservations public (B12, B13)", () => {
    const ci = read(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("  supabase:"));
    const jobEnv = job.slice(job.indexOf("    env:"), job.indexOf("    steps:"));
    const value = (name: string) =>
      new RegExp(`^\\s+${name}:\\s*(\\S+)\\s*$`, "m").exec(jobEnv)?.[1];

    it("the supabase job env has fake keys of at least 32 characters, none a secret", () => {
      for (const name of ["RESERVATION_GATE_KEY", "RESERVATION_LINK_KEY", "CRON_SECRET"]) {
        const fake = value(name);
        expect(fake, name).toBeDefined();
        expect(fake!.length, name).toBeGreaterThanOrEqual(32);
        expect(fake, name).toMatch(/^(replace-me|test)-/);
        expect(jobEnv).not.toMatch(new RegExp(`${name}:\\s*\\$\\{\\{\\s*secrets\\.`));
      }
      // The fakes live in the supabase job only, not in the job without a stack.
      const before = ci.slice(0, ci.indexOf("  supabase:"));
      for (const name of ["RESERVATION_GATE_KEY", "RESERVATION_LINK_KEY", "CRON_SECRET"]) {
        expect(before, name).not.toContain(name);
      }
    });

    it("the gate key equals the fake Vault value of supabase/seed.sql, so the app and the database agree", () => {
      expect(read("supabase/seed.sql")).toContain(
        `'${value("RESERVATION_GATE_KEY")}', 'reservation_gate_key'`,
      );
    });

    it("sends mail through Mailpit, from an example.com sender, with the app's own origin", () => {
      expect(value("MAIL_TRANSPORT")).toBe("mailpit");
      expect(value("MAIL_FROM")).toMatch(/@example\.com$/);
      expect(value("APP_PUBLIC_ORIGIN")).toBe("http://localhost:3000");
    });

    it("MAILPIT_URL is exported from the same status as E2E_MAILPIT_URL, before the integration tests", () => {
      const exportAt = job.indexOf("Export local Supabase settings");
      const stepAt = job.indexOf("npm run test:integration");
      const line = /echo "MAILPIT_URL=\$\(pick '([^']+)'\)"/.exec(job);
      expect(line?.[1]).toBe(/echo "E2E_MAILPIT_URL=\$\(pick '([^']+)'\)"/.exec(job)?.[1]);
      expect(job.indexOf(line![0])).toBeGreaterThan(exportAt);
      expect(job.indexOf(line![0])).toBeLessThan(stepAt);
    });

    it("the public integration suite and its mail helper exist", () => {
      for (const path of [
        "tests/integration/reservations-public.int.ts",
        "tests/integration/helpers/reservation-mail.ts",
      ]) {
        expect(() => read(path), path).not.toThrow();
      }
    });
  });
});
