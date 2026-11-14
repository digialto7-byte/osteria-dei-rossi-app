import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// One root cause, every workflow (lead, #122): the local stack's ports (54320-54329) lie inside Linux's ephemeral range, so any job that runs
// `supabase start` first moves the range above them (`reserve`, once per job, before its first start) and waits until they are free right before each
// start (`wait-free 90`, in the start step itself or the step just before it). New workflows are covered automatically: the list is read from disk.
const DIR = new URL("../../.github/workflows/", import.meta.url);
const RESERVE = "bash scripts/ci/supabase-ports.sh reserve";
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

  it.each(starting)("$id: reserve once, before the first start", ({ steps }) => {
    const first = steps.findIndex((s) => START.test(s));
    const reserves = steps.flatMap((s, i) => (s.includes(RESERVE) ? [i] : []));
    expect(reserves).toHaveLength(1);
    expect(reserves[0]).toBeLessThanOrEqual(first);
    const step = steps[reserves[0]!]!;
    if (reserves[0] === first) expect(step.indexOf(RESERVE)).toBeLessThan(step.search(START));
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
