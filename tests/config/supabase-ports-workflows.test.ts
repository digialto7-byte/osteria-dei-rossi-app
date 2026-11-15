import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// One root cause, every workflow (lead, #122): the local stack's ports (54320-54329) lie inside Linux's ephemeral range, so any job that runs
// `supabase start` moves the range above them in its FIRST step, before checkout, npm ci or any other network use (T1 spike, run 43656779665: a
// connection opened before a later move kept 54322 and 54324 for the whole job), and waits until they are free right before each start
// (`wait-free 90`, in the start step itself or the step just before it). New workflows are covered automatically: the list is read from disk.
const DIR = new URL("../../.github/workflows/", import.meta.url);
const RESERVE = 'run: sudo sysctl -w net.ipv4.ip_local_port_range="55000 60999"';
const WAIT = "bash scripts/ci/supabase-ports.sh wait-free 90";
const START = /npx supabase start\b/;

/** The jobs of a workflow, each split into its step blocks, in order (the repo's workflow tests split the same way). */
function jobsOf(text: string): { name: string; steps: string[] }[] {
  const body = text.slice(text.indexOf("\njobs:\n"));
  return body
    .split(/\n(?= {2}[\w-]+:\n)/)
    .slice(1)
    .map((block) => ({
      name: /^ {2}([\w-]+):/.exec(block)![1]!,
      steps: block.includes("    steps:")
        ? block
            .slice(block.indexOf("    steps:"))
            .split(/\n(?= {6}- )/)
            .slice(1)
        : [],
    }));
}

/** The step's lines that are not comments, so a commented-out command never counts. */
const code = (step: string) =>
  step
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

const workflows = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((file) => ({ file, jobs: jobsOf(readFileSync(new URL(file, DIR), "utf8")) }));
const starting = workflows.flatMap(({ file, jobs }) =>
  jobs
    .filter((job) => job.steps.some((s) => START.test(code(s))))
    .map((job) => ({ id: `${file} › ${job.name}`, steps: job.steps.map(code) })),
);

describe("every job that starts the local stack keeps its ports free", () => {
  it("finds the jobs it guards: ci.yml (supabase, t1-spike), the backup self-test, the weekly restore and the SP0 spike", () => {
    expect(starting.map((j) => j.id).sort()).toEqual([
      "backup-restore-weekly.yml › restore",
      "backup-selftest.yml › selftest",
      "ci.yml › supabase",
      "ci.yml › t1-spike",
      "sp0-spike.yml › sp0",
    ]);
  });

  it.each(starting)(
    "$id: reserve once, as the first step (only a step that reads a variable may come before it)",
    ({ steps }) => {
      const reserves = steps.flatMap((s, i) => (s.includes(RESERVE) ? [i] : []));
      expect(reserves).toHaveLength(1);
      // The weekly restore first decides whether it is armed: that step only reads a variable and opens no connection.
      const before = steps.slice(0, reserves[0]);
      for (const step of before) {
        expect(step).toMatch(/^\s+- name: Check that the backups are armed\n\s+id: arm\n/);
        expect(step).not.toMatch(/uses:|npm |npx |curl |apt-get|docker /);
      }
      expect(before.length).toBeLessThanOrEqual(1);
      const checkout = steps.findIndex((s) => s.includes("uses: actions/checkout"));
      expect(reserves[0]).toBeLessThan(checkout);
    },
  );

  it("the script no longer moves the range: a late move is what let a connection keep a stack port", () => {
    for (const { file, jobs } of workflows)
      for (const job of jobs)
        for (const step of job.steps)
          expect(code(step), `${file} › ${job.name}`).not.toContain("supabase-ports.sh reserve");
  });

  it.each(starting)("$id: wait until the ports are free right before every start", ({ steps }) => {
    steps.forEach((step, i) => {
      if (!START.test(step)) return;
      const inStep = step.includes(WAIT) && step.indexOf(WAIT) < step.search(START);
      const justBefore = i > 0 && steps[i - 1]!.includes(WAIT) && !START.test(steps[i - 1]!);
      expect(inStep || justBefore, `step ${i}`).toBe(true);
    });
  });

  it.each(starting)(
    "$id: the port steps carry the same condition as the start (an unarmed run does nothing)",
    ({ steps }) => {
      const first = steps.findIndex((s) => START.test(s));
      const condition = (s: string) => /^\s+if: (.+)$/m.exec(s)?.[1] ?? null;
      const reserve = steps.find((s) => s.includes(RESERVE))!;
      expect(condition(reserve)).toBe(condition(steps[first]!));
    },
  );
});
