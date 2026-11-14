import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SP0 (docs/plans/2026-11-14-sp00-spike.md S13): the local parts of the spike run in their own workflow, on the local Supabase stack only.
// It touches no hosted project and holds no repository secret.
const path = new URL("../../.github/workflows/sp0-spike.yml", import.meta.url);
const workflow = existsSync(path) ? readFileSync(path, "utf8") : "";

const at = (marker: string): number => {
  const index = workflow.indexOf(marker);
  if (index === -1) throw new Error(`the workflow has no ${marker}`);
  return index;
};

describe("sp0-spike workflow", () => {
  it("exists", () => {
    expect(workflow).not.toBe("");
  });

  it("runs on dispatch and on pull requests that touch the spike, migrations or the Auth config", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\n {2}pull_request:/m);
    expect(workflow).toContain("types: [opened, synchronize, reopened, ready_for_review]");
    const paths = [
      "scripts/spike/**",
      "scripts/lib/sp00/**",
      "supabase/migrations/**",
      "supabase/config.toml",
      ".github/workflows/sp0-spike.yml",
    ];
    const block = /paths:\n((?: {6}- .*\n)+)/.exec(workflow)?.[1] ?? "";
    expect(
      block
        .split("\n")
        .filter(Boolean)
        .map((line) => line.replace(/^ {6}- /, "").replace(/"/g, "")),
    ).toEqual(paths);
    expect(workflow).not.toMatch(/^\s*(push|schedule|pull_request_target|workflow_run):/m);
  });

  it("starts the heavy job on non-draft pull requests only (as ci.yml)", () => {
    expect(workflow).toContain(
      "if: github.event_name != 'pull_request' || github.event.pull_request.draft == false",
    );
  });

  it("is pinned to ubuntu-24.04, read-only, without persisted credentials", () => {
    const runners = [...workflow.matchAll(/^\s+runs-on: (.+)$/gm)].map((m) => m[1]);
    expect(runners).toEqual(["ubuntu-24.04"]);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).toContain("persist-credentials: false");
  });

  it("starts the local stack WITH Realtime (T2 needs it), unlike the AT8 job", () => {
    const start = /npx supabase start\s+-x ([a-z,-]+)/.exec(workflow)?.[1] ?? "";
    expect(start).not.toBe("");
    expect(start.split(",")).not.toContain("realtime");
    expect(start.split(",")).toEqual(
      expect.arrayContaining([
        "studio",
        "imgproxy",
        "edge-runtime",
        "logflare",
        "vector",
        "supavisor",
        "postgres-meta",
      ]),
    );
  });

  it("holds no repository secret and no hosted credential", () => {
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
    expect(workflow).not.toMatch(
      /SUPABASE_ACCESS_TOKEN|SPIKE_DB_URL|db push|supabase link|SUPABASE_DB_URL/,
    );
    expect(workflow).not.toMatch(/\.supabase\.co/);
    expect(workflow).not.toMatch(/SPIKE_TEMP_OK|SPIKE_PROJECT_REF|--target temp/);
  });

  it("installs psql and exports the local settings, including SPIKE_LOCAL_DB_URL, from supabase status", () => {
    expect(workflow).toContain(
      "psql --version || (sudo apt-get update && sudo apt-get install -y postgresql-client)",
    );
    expect(workflow).toContain("npx supabase status -o json");
    for (const name of [
      "SPIKE_SUPABASE_URL",
      "SPIKE_PUBLISHABLE_KEY",
      "SPIKE_SECRET_KEY",
      "E2E_MAILPIT_URL",
      "SPIKE_LOCAL_DB_URL",
    ]) {
      expect(workflow, name).toMatch(new RegExp(`echo "${name}=\\$\\(pick '[^']+'\\)"`));
    }
    expect(workflow).toMatch(/SPIKE_LOCAL_DB_URL=\$\(pick '\.DB_URL'\)/);
  });

  it("runs the steps in the planned order", () => {
    const order = [
      "npx supabase start",
      "target_marker",
      "00_guard.sql",
      "sp00-auth.ts --target local --checks t5",
      "01_hook_probe.sql",
      "90_selfcheck_a.sql",
      "02_console_role.sql",
      "90_selfcheck_b.sql",
      "03_memberships.sql",
      "90_selfcheck_c.sql",
      "sp00-auth.ts --target local --checks t1",
      "sp00-auth.ts --target local --checks t2",
      "sp00-auth.ts --target local --checks t3",
      "04_t4.sql",
      "sp00-t4-seed.ts --target local",
      "90_selfcheck_d.sql",
      "t4_snapshot",
      "t4_measure",
      "t4_fill",
      "t4_isolation",
      "docker logs",
    ];
    const positions = order.map(at);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("marks the local stack in the guard's marker table with the ref 'local'", () => {
    expect(workflow).toMatch(
      /create table sp0\.target_marker \(project_ref text not null, production_ref text, created_at timestamptz not null default now\(\)\)/,
    );
    expect(workflow).toContain("insert into sp0.target_marker (project_ref) values ('local')");
  });

  it("applies every SQL file with psql and ON_ERROR_STOP", () => {
    const calls = [...workflow.matchAll(/psql "\$SPIKE_LOCAL_DB_URL"[^\n]*/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const call of calls) expect(call).toContain("-v ON_ERROR_STOP=1");
    for (const file of [
      "00_guard",
      "01_hook_probe",
      "02_console_role",
      "03_memberships",
      "04_t4",
      "90_selfcheck_a",
      "90_selfcheck_b",
      "90_selfcheck_c",
      "90_selfcheck_d",
    ]) {
      expect(workflow, file).toContain(`scripts/spike/sp00/sql/${file}.sql`);
    }
  });

  it("measures one tenant, fills two clones, measures three, with 5 runs, and checks the isolation", () => {
    expect(workflow).toMatch(/t4_snapshot\(.*'1 tenant'\)/);
    expect(workflow).toMatch(/t4_fill\(.*, 2, \d+\)/);
    expect(workflow).toMatch(/t4_snapshot\(.*'3 tenants'\)/);
    expect(workflow).toMatch(/t4_measure\(.*, 5\)/);
    for (const fn of ["mfa_gate", "dashboard_summary", "menu_list", "kitchen_tickets"])
      expect(workflow, fn).toContain(fn);
    expect(workflow).toMatch(/t4_isolation\(.*\)/);
    expect(workflow).toContain("pass");
  });

  it("builds and starts no app", () => {
    expect(workflow).not.toMatch(
      /next build|next start|npm run build|npm run start|playwright|chromium|webkit|npm run e2e/i,
    );
  });

  it("prints the Auth log on failure, as the last step", () => {
    const last = workflow.slice(workflow.lastIndexOf("      - name:"));
    expect(last).toContain("if: failure()");
    expect(last).toContain("docker logs");
  });
});
