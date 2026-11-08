import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 18 (founder Q180 = B): the heavy `supabase` job is two shards, each with its own stack, build and 30-minute cap. Shard 1 also runs pgTAP and the
// integration suite (once is enough); both shards run their half of Playwright, which now includes the service simulation. The simulation and the order
// fixtures call `psql` (e2e/helpers/invariants.ts, seed-order.ts), so the `psql` check runs in BOTH shards.
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const DRAFT_GATE =
  "if: github.event_name != 'pull_request' || github.event.pull_request.draft == false";

function job(name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job ${name}`);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The steps of a job: each starts at "      - " at six spaces. */
function steps(text: string): string[] {
  const body = text.slice(text.indexOf("\n    steps:\n") + "\n    steps:\n".length);
  return body.split(/\n(?= {6}- )/);
}

const supabase = job("supabase");
const list = steps(supabase);
const find = (needle: string) => list.findIndex((step) => step.includes(needle));

describe("the supabase job in two shards", () => {
  it("is a matrix of shards 1 and 2 that stops the other shard on a failure", () => {
    expect(supabase).toMatch(
      /\n {4}strategy:\n {6}fail-fast: true\n {6}matrix:\n {8}shard: \[1, 2\]\n/,
    );
  });

  it("keeps the 30-minute cap and the draft gate, and names the shard in the job name", () => {
    expect(supabase).toMatch(/\n {4}timeout-minutes: 30\n/);
    expect(supabase).toContain(`\n    ${DRAFT_GATE}\n`);
    expect(supabase).toMatch(/\n {4}name: .*\$\{\{ matrix\.shard \}\}/);
  });

  it("runs the steps in order: npm ci, stack, pgTAP, settings, psql, integration, build, browsers, Playwright", () => {
    const order = [
      "run: npm ci",
      "npx supabase start",
      "run: npx supabase test db",
      "Export local Supabase settings",
      "psql --version",
      "run: npm run test:integration",
      "run: npm run build",
      "npx playwright install --with-deps chromium webkit",
      "npx playwright test --shard=${{ matrix.shard }}/2",
    ].map(find);
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("only pgTAP and the integration suite are limited to shard 1; every other step runs in both", () => {
    const limited = list.filter((step) => /\bif: matrix\.shard\b/.test(step));
    expect(limited).toHaveLength(2);
    expect(limited.some((step) => step.includes("run: npx supabase test db"))).toBe(true);
    expect(limited.some((step) => step.includes("run: npm run test:integration"))).toBe(true);
    expect(supabase.match(/matrix\.shard == 1/g)).toHaveLength(2);
    expect(supabase.match(/matrix\.shard == 2/g)).toBeNull();
  });

  it("checks that psql is there in both shards (the simulation and the order fixtures use it)", () => {
    const psql = list[find("psql --version")]!;
    expect(psql).toBeDefined();
    expect(psql).not.toContain("if:");
  });

  it("runs one Playwright command with the shard, and one build per shard", () => {
    expect(ci.match(/npx playwright test/g)).toHaveLength(1);
    expect(supabase.match(/npm run build/g)).toHaveLength(1);
  });

  it("uploads the report under the shard's own name on failure", () => {
    const upload = list[find("upload-artifact")]!;
    expect(upload).toContain("if: failure()");
    expect(upload).toContain("name: playwright-report-${{ matrix.shard }}");
  });

  it("leaves the other heavy jobs unsharded", () => {
    for (const name of ["db-races", "t1-spike"]) {
      expect(job(name), name).not.toContain("matrix");
      expect(job(name), name).toContain(`\n    ${DRAFT_GATE}\n`);
    }
  });
});
