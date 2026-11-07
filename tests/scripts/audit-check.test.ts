import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateAudit,
  parseExceptions,
  type AuditExceptions,
  type AuditReport,
} from "../../scripts/lib/audit-check";
import { runAuditCheck } from "../../scripts/audit-check";

// AT3 (M25 step 5): the dependency audit gate. The fixtures follow the shape of a real `npm audit --json`
// (auditReportVersion 2); the advisories named "fake-*" are made-up fixtures, because the real tree has no high advisory.
const fixture = (name: string): AuditReport =>
  JSON.parse(readFileSync(new URL(`../fixtures/npm-audit/${name}.json`, import.meta.url), "utf8"));
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const TODAY = "2026-11-03";
const exception = (over: Record<string, unknown> = {}) => ({
  package: "fake-dev-tool",
  advisory: "GHSA-xxxx-yyyy-zzzz",
  reason: "Only the dev linter loads it; no fix published.",
  reviewBy: "2026-11-04",
  devOnly: true,
  ...over,
});
const withExceptions = (...list: Record<string, unknown>[]): AuditExceptions =>
  parseExceptions({ exceptions: list });

describe("evaluateAudit", () => {
  it("passes a tree with only moderate advisories", () => {
    const failures = evaluateAudit(
      fixture("clean"),
      fixture("prod-clean"),
      withExceptions(),
      TODAY,
    );
    expect(failures).toEqual([]);
  });

  it("fails a high dev advisory that is not excepted, naming package and advisory", () => {
    const failures = evaluateAudit(
      fixture("high-dev"),
      fixture("prod-clean"),
      withExceptions(),
      TODAY,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("fake-dev-tool");
    expect(failures[0]).toContain("GHSA-xxxx-yyyy-zzzz");
    expect(failures[0]).toContain("high");
  });

  it("passes an excepted advisory whose review date is tomorrow", () => {
    const failures = evaluateAudit(
      fixture("high-dev"),
      fixture("prod-clean"),
      withExceptions(exception()),
      TODAY,
    );
    expect(failures).toEqual([]);
  });

  it("passes on the review date itself and fails the day after (boundary)", () => {
    const list = withExceptions(exception({ reviewBy: TODAY }));
    expect(evaluateAudit(fixture("high-dev"), fixture("prod-clean"), list, TODAY)).toEqual([]);
    expect(
      evaluateAudit(fixture("high-dev"), fixture("prod-clean"), list, "2026-11-04"),
    ).toHaveLength(1);
  });

  it("fails an expired exception (review date yesterday)", () => {
    const failures = evaluateAudit(
      fixture("high-dev"),
      fixture("prod-clean"),
      withExceptions(exception({ reviewBy: "2026-11-02" })),
      TODAY,
    );
    expect(failures.join("\n")).toContain("exception expired");
    expect(failures.join("\n")).toContain("fake-dev-tool");
  });

  it("fails an exception with an empty or blank reason", () => {
    for (const reason of ["", "   "]) {
      const failures = evaluateAudit(
        fixture("high-dev"),
        fixture("prod-clean"),
        withExceptions(exception({ reason })),
        TODAY,
      );
      expect(failures.join("\n")).toContain("reason");
    }
  });

  it("fails a stale exception that matches no current high or critical advisory", () => {
    const failures = evaluateAudit(
      fixture("clean"),
      fixture("prod-clean"),
      withExceptions(exception()),
      TODAY,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("stale");
    expect(failures[0]).toContain("fake-dev-tool");
  });

  it("does not let a devOnly exception excuse a critical runtime advisory", () => {
    const list = withExceptions(
      exception({ package: "fake-runtime-lib", advisory: "GHSA-aaaa-bbbb-cccc", devOnly: true }),
    );
    const failures = evaluateAudit(
      fixture("critical-runtime"),
      fixture("critical-runtime"),
      list,
      TODAY,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("fake-runtime-lib");
    expect(failures[0]).toContain("critical");
    expect(failures[0]).toContain("devOnly");
  });

  it("accepts a runtime exception that says it is not devOnly", () => {
    const list = withExceptions(
      exception({ package: "fake-runtime-lib", advisory: "GHSA-aaaa-bbbb-cccc", devOnly: false }),
    );
    expect(
      evaluateAudit(fixture("critical-runtime"), fixture("critical-runtime"), list, TODAY),
    ).toEqual([]);
  });

  it("matches the advisory as well as the package", () => {
    const failures = evaluateAudit(
      fixture("high-dev"),
      fixture("prod-clean"),
      withExceptions(exception({ advisory: "GHSA-0000-0000-0000" })),
      TODAY,
    );
    expect(failures.join("\n")).toContain("GHSA-xxxx-yyyy-zzzz");
    expect(failures.join("\n")).toContain("stale");
  });
});

describe("parseExceptions", () => {
  it("rejects a malformed file", () => {
    expect(() => parseExceptions({})).toThrow();
    expect(() => parseExceptions({ exceptions: [{ package: "x" }] })).toThrow();
    expect(() => parseExceptions({ exceptions: [exception({ reviewBy: "tomorrow" })] })).toThrow();
  });

  it("accepts the committed file", () => {
    const parsed = parseExceptions(JSON.parse(read("docs/go-live/audit-exceptions.json")));
    expect(Array.isArray(parsed.exceptions)).toBe(true);
  });
});

describe("runAuditCheck", () => {
  const exceptionsFile = (list: Record<string, unknown>[]) => JSON.stringify({ exceptions: list });
  function run(options: { all: string; prod: string; file: string; exit?: number }) {
    const out: string[] = [];
    const err: string[] = [];
    const commands: string[][] = [];
    const code = runAuditCheck({
      now: new Date("2026-11-03T10:00:00Z"),
      readExceptions: () => options.file,
      audit: (args) => {
        commands.push(args);
        return args.includes("--omit=dev") ? options.prod : options.all;
      },
      write: (t) => out.push(t),
      writeError: (t) => err.push(t),
    });
    return { code, out, err, commands };
  }
  const text = (name: string) => JSON.stringify(fixture(name));

  it("exits 0 on a clean tree and asks npm for the full and the runtime report", () => {
    const r = run({ all: text("clean"), prod: text("prod-clean"), file: exceptionsFile([]) });
    expect(r.code).toBe(0);
    expect(r.commands).toEqual([
      ["audit", "--json"],
      ["audit", "--omit=dev", "--json"],
    ]);
  });

  it("exits 1 and prints the finding on a high advisory", () => {
    const r = run({ all: text("high-dev"), prod: text("prod-clean"), file: exceptionsFile([]) });
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("GHSA-xxxx-yyyy-zzzz");
  });

  it("exits 1 on a stale exception", () => {
    const r = run({
      all: text("clean"),
      prod: text("prod-clean"),
      file: exceptionsFile([exception()]),
    });
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("stale");
  });

  it("exits 1 when npm returns something that is not an audit report", () => {
    const r = run({ all: "not json", prod: text("prod-clean"), file: exceptionsFile([]) });
    expect(r.code).toBe(1);
  });

  it("exits 1 when the exceptions file is malformed", () => {
    const r = run({ all: text("clean"), prod: text("prod-clean"), file: "{" });
    expect(r.code).toBe(1);
  });
});
