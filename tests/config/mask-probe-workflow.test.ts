import { existsSync, readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

// TEMPORARY (SP3 round 2, item C): the masking probe is removed before the PR merges, together with this test and the fixture. It runs the EXACT bytes of the
// platform-ops read step against a fixture event, then tries to leak the fixture's fake uuid in separate steps, so the lead can read the PUBLIC run log and see
// whether GitHub masks it. It is outside the platform-ops guard: that guard parses platform-ops.yml only.
const PROBE = new URL("../../.github/workflows/mask-probe.yml", import.meta.url);
const OPS = new URL("../../.github/workflows/platform-ops.yml", import.meta.url);
const FIXTURE = new URL("../../.github/mask-probe/event.json", import.meta.url);
const FAKE_USER = "c0ffee00-0000-4000-8000-00000000f00d";
const FAKE_ACTOR = "c0ffee00-0000-4000-8000-00000000beef";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };
const parse = (url: URL): Obj => load(readFileSync(url, "utf8")) as Obj;
const stepsOf = (workflow: Obj, job: string): Obj[] =>
  ((workflow.jobs as Obj)[job] as Obj).steps as Json[] as Obj[];

describe("mask probe (temporary)", () => {
  it("exists, with its fixture", () => {
    expect(existsSync(PROBE)).toBe(true);
    expect(existsSync(FIXTURE)).toBe(true);
  });

  it("the fixture holds fake lowercase uuids and the inputs the mfa-reset read step reads", () => {
    const event = JSON.parse(readFileSync(FIXTURE, "utf8")) as { inputs: Record<string, unknown> };
    expect(event.inputs).toEqual({
      operation: "mfa-reset",
      user: FAKE_USER,
      actor: FAKE_ACTOR,
      conferma_disconnessione: true,
    });
  });

  it("runs on pull_request only, with no environment, no secret, no token permission and the pinned runner", () => {
    const probe = parse(PROBE);
    expect(Object.keys(probe.on as Obj)).toEqual(["pull_request"]);
    expect(probe.permissions).toEqual({});
    const text = readFileSync(PROBE, "utf8");
    expect(text).not.toMatch(/^\s*environment:/m);
    expect(text).not.toContain("secrets.");
    expect(((probe.jobs as Obj).probe as Obj)["runs-on"]).toBe("ubuntu-24.04");
    expect(text.split("\n").slice(0, 8).join("\n")).toMatch(/TEMPORARY/);
    expect(text.split("\n").slice(0, 8).join("\n")).toMatch(/removed before (the PR )?merge/i);
  });

  it("its read step is byte-identical to the platform-ops mfa-reset read step, after one line that points it at the fixture", () => {
    const exact = stepsOf(parse(OPS), "mfa-reset")[0]!.run as string;
    const probeRun = stepsOf(parse(PROBE), "probe").find((s) => s.name === "Read the inputs")?.run;
    expect(typeof probeRun).toBe("string");
    expect(probeRun).toBe(
      `export GITHUB_EVENT_PATH="$PWD/.github/mask-probe/event.json"\n${exact}`,
    );
    expect(
      stepsOf(parse(PROBE), "probe").find((s) => s.name === "Read the inputs")?.env,
    ).toBeUndefined();
  });

  it("then tries to leak the fake uuid in three separate steps, each continue-on-error: true", () => {
    const steps = stepsOf(parse(PROBE), "probe");
    const leaks = steps.filter((s) => String(s.name).startsWith("Leak:"));
    expect(leaks.map((s) => s.name)).toEqual([
      "Leak: a step env value, echoed",
      "Leak: the value exported through GITHUB_ENV, echoed",
      "Leak: a failing command with the uuid as its argument",
    ]);
    for (const leak of leaks) expect(leak["continue-on-error"]).toBe(true);
    expect((leaks[0]!.env as Obj).PROBE_ENV).toBe(FAKE_USER);
    expect(leaks[0]!.run).toContain('echo "$PROBE_ENV"');
    expect(leaks[1]!.run).toContain('echo "$USER_ID"');
    expect(leaks[2]!.run).toContain('ls "/does-not-exist/$USER_ID"');
    // The read step comes first and no other step has continue-on-error.
    expect(steps.filter((s) => s["continue-on-error"] === true)).toHaveLength(3);
    expect(steps.findIndex((s) => s.name === "Read the inputs")).toBeLessThan(
      steps.indexOf(leaks[0]!),
    );
  });
});
