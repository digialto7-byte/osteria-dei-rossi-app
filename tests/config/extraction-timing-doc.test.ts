import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTRACTION_EFFORTS } from "../../src/lib/env";
import {
  EXTRACTION_MAX_TOKENS,
  EXTRACTION_TIMEOUT_MS,
  MAX_EXTRACTED_LINES,
} from "../../src/server/extraction/constants";

// P2-0 F26: docs/go-live/extraction-timing.md holds the method, the runs and the decision about the extraction limits. The decision rule is fixed
// before any number exists, and this test applies it: `Decision: no change` is refused while a run timed out, was truncated, or projects (linearly,
// per line, to MAX_EXTRACTED_LINES lines) to the token ceiling or the request timeout. Every cell is `pending` today; the refusals are proved on
// documents derived from the real one. The document holds counts and timings only, never a request id, an error message or invoice content.
const ROOT = new URL("../../", import.meta.url).pathname;
const DOC = readFileSync(join(ROOT, "docs/go-live/extraction-timing.md"), "utf8");
const OUTCOME_TS = readFileSync(join(ROOT, "src/server/extraction/outcome.ts"), "utf8");
const SECRET =
  /sb_secret_|sk-ant-|re_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}/;

const HEADER = ["run", "outcome", "lines", "outputTokens", "durationMs", "effort"];
const FORBIDDEN_COLUMNS = [
  "requestId",
  "errorMessage",
  "flags",
  "supplier",
  "description",
  "amount",
];

/** The FailureCode literals, read from the source so that a new code shows up here. */
const FAILURE_CODES = [
  ...(/export type FailureCode =([^;]+);/.exec(OUTCOME_TS)?.[1] ?? "").matchAll(/"([a-z_]+)"/g),
].map((m) => m[1]!);

function section(md: string, title: string): string {
  const start = md.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`no section ${title}`);
  const rest = md.slice(start + 1);
  const next = rest.slice(3).search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

function runs(md: string): { header: string[]; rows: string[][] } {
  const lines = section(md, "Runs")
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/`/g, "")),
    );
  const [header = [], ...rows] = lines;
  return { header, rows };
}

const isInt = (cell: string) => /^\d+$/.test(cell);

/** Why the table is malformed; empty when it is well formed. */
function shapeProblems(md: string): string[] {
  const { header, rows } = runs(md);
  const problems: string[] = [];
  if (header.join(", ") !== HEADER.join(", ")) problems.push(`bad header: ${header.join(", ")}`);
  rows.forEach((cells, index) => {
    if (cells.length !== HEADER.length) return void problems.push(`row ${index + 1}: bad width`);
    const [run, outcome, lines, tokens, ms, effort] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!["pending", ...EXTRACTION_EFFORTS].includes(effort))
      problems.push(`row ${index + 1}: bad effort ${effort}`);
    if (!isInt(run)) problems.push(`row ${index + 1}: run is not an integer`);
    if (!["ok", "pending", ...FAILURE_CODES].includes(outcome))
      problems.push(`row ${index + 1}: bad outcome ${outcome}`);
    for (const cell of [lines, tokens, ms])
      if (!isInt(cell) && cell !== "pending") problems.push(`row ${index + 1}: bad cell ${cell}`);
  });
  return problems;
}

/** The rule of the Decision section, over the runs of the document. */
function ruleHolds(md: string): string[] {
  const reasons: string[] = [];
  const ok = runs(md).rows.filter((cells) => cells[1] === "ok");
  for (const [run, outcome] of runs(md).rows) {
    if (outcome === "provider_timeout" || outcome === "output_truncated")
      reasons.push(`run ${run}: ${outcome}`);
  }
  const perLine = (column: 3 | 4) =>
    ok
      .filter((cells) => isInt(cells[2]!) && Number(cells[2]) >= 1 && isInt(cells[column]!))
      .map((cells) => Number(cells[column]) / Number(cells[2]));
  if (Math.max(0, ...perLine(3)) * MAX_EXTRACTED_LINES >= EXTRACTION_MAX_TOKENS)
    reasons.push("tokens per line projected to the token ceiling");
  if (Math.max(0, ...perLine(4)) * MAX_EXTRACTED_LINES >= EXTRACTION_TIMEOUT_MS)
    reasons.push("milliseconds per line projected to the request timeout");
  return reasons;
}

/** Problems with the Decision line of a document; empty when it is acceptable. */
function decisionProblems(md: string): string[] {
  const lines = section(md, "Decision").match(/^Decision: .*$/gm) ?? [];
  if (lines.length !== 1) return [`expected exactly one Decision line, found ${lines.length}`];
  const line = lines[0]!;
  if (!/^Decision: (pending|no change|change: .+)$/.test(line)) return [`bad decision: ${line}`];
  const { rows } = runs(md);
  const anyPending = rows.some((cells) => cells.includes("pending"));
  const ok = rows.filter((cells) => cells[1] === "ok");
  const problems: string[] = [];
  if (line === "Decision: no change") {
    const reasons = ruleHolds(md);
    if (reasons.length > 0) problems.push(`no change is refused: ${reasons.join("; ")}`);
    if (rows.some((cells) => cells[1] === "pending"))
      problems.push("no change, but a run's outcome is still pending");
    if (ok.length === 0) problems.push("no change, but there is no ok run");
    if (
      ok.some(
        (cells) =>
          !isInt(cells[2]!) || Number(cells[2]) < 1 || !isInt(cells[3]!) || !isInt(cells[4]!),
      )
    )
      problems.push("no change, but an ok run lacks lines, tokens or milliseconds");
  }
  if (line === "Decision: pending" && !anyPending) problems.push("pending, but no cell is pending");
  return problems;
}

/** The value of each constant written out in text: plain, with a thousands separator, or (for a whole number of seconds) as seconds. */
function valueLeaks(text: string): string[] {
  const leaks: string[] = [];
  for (const [name, value] of [
    ["EXTRACTION_MAX_TOKENS", EXTRACTION_MAX_TOKENS],
    ["EXTRACTION_TIMEOUT_MS", EXTRACTION_TIMEOUT_MS],
    ["MAX_EXTRACTED_LINES", MAX_EXTRACTED_LINES],
  ] as const) {
    const forms = [
      String(value),
      String(value).replace(/(\d)(?=(\d{3})+$)/g, "$1[ ,._\u00a0\u202f]?"),
    ];
    if (value % 1000 === 0) {
      forms.push(`${value / 1000}\\s?(?:k|s|sec|secs|seconds|secondi)`);
      forms.push(`${value / 1000}\\s?k`);
    }
    if (
      forms.some((form) => new RegExp(`(?<![\\w.,])(?:${form})(?![\\w.,]*\\d)\\b`, "i").test(text))
    )
      leaks.push(name);
  }
  return leaks;
}

const setDecision = (md: string, value: string) =>
  md.replace(/^Decision: .*$/m, `Decision: ${value}`);
/** The document with the Runs table body replaced by the given rows (the header and the separator stay). */
function withRuns(md: string, rows: string[][]): string {
  const block = section(md, "Runs");
  const lines = block.split("\n");
  const tableStart = lines.findIndex((line) => line.startsWith("| run"));
  const head = lines.slice(0, tableStart + 2);
  const tail = lines.slice(tableStart + 2).filter((line) => !line.startsWith("|"));
  return md.replace(
    block,
    [...head, ...rows.map((cells) => `| ${cells.join(" | ")} |`), ...tail].join("\n"),
  );
}

const SMALL: string[][] = [
  ["1", "ok", "12", "1200", "4000", "high"],
  ["2", "ok", "30", "3000", "12000", "high"],
];
const PER_LINE_TOKENS = EXTRACTION_MAX_TOKENS / MAX_EXTRACTED_LINES;
const PER_LINE_MS = EXTRACTION_TIMEOUT_MS / MAX_EXTRACTED_LINES;

describe("docs/go-live/extraction-timing.md", () => {
  it("has exactly the sections Method, Runs and Decision, in this order", () => {
    expect([...DOC.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([
      "Method",
      "Runs",
      "Decision",
    ]);
  });

  it("has the pinned Runs header, no forbidden column, and well-formed cells", () => {
    const { header } = runs(DOC);
    expect(header).toEqual(HEADER);
    for (const name of FORBIDDEN_COLUMNS) expect(header).not.toContain(name);
    expect(shapeProblems(DOC)).toEqual([]);
  });

  it("reads the outcome codes from outcome.ts", () => {
    expect(FAILURE_CODES).toContain("provider_timeout");
    expect(FAILURE_CODES).toContain("output_truncated");
    expect(FAILURE_CODES.length).toBeGreaterThanOrEqual(8);
  });

  it("the Method names the log event and forbids copying requestId and errorMessage", () => {
    const method = section(DOC, "Method");
    expect(method).toContain('"event":"extraction"');
    expect(method).toMatch(/never copy[^.]*`requestId`/i);
    expect(method).toContain("`errorMessage`");
  });

  it("states the rule with the constants' names, and writes none of their values", () => {
    const decision = section(DOC, "Decision");
    for (const name of ["EXTRACTION_MAX_TOKENS", "EXTRACTION_TIMEOUT_MS", "MAX_EXTRACTED_LINES"])
      expect(decision).toContain(name);
    expect(valueLeaks(decision)).toEqual([]);
  });

  it("the value check refuses plain, separated and seconds forms of the constants", () => {
    expect(valueLeaks("limit 36000 tokens")).toHaveLength(1);
    expect(valueLeaks("limit 36,000 tokens")).toHaveLength(1);
    expect(valueLeaks("limit 36 000 tokens")).toHaveLength(1);
    expect(valueLeaks("limit 36.000 tokens")).toHaveLength(1);
    expect(valueLeaks("timeout 90000 ms")).toHaveLength(1);
    expect(valueLeaks("timeout 90,000 ms")).toHaveLength(1);
    expect(valueLeaks("timeout 90 s")).toHaveLength(1);
    expect(valueLeaks("timeout 90s")).toHaveLength(1);
    expect(valueLeaks("timeout 90 seconds")).toHaveLength(1);
    expect(valueLeaks("at most 200 lines")).toHaveLength(1);
    expect(valueLeaks("the ceiling of EXTRACTION_MAX_TOKENS, run 1 of 3")).toEqual([]);
  });

  it("has exactly one Decision line, and today it is pending", () => {
    expect(section(DOC, "Decision").match(/^Decision: .*$/gm)).toEqual(["Decision: pending"]);
    expect(decisionProblems(DOC)).toEqual([]);
  });

  it("has nothing that looks like a secret", () => {
    expect(DOC).not.toMatch(SECRET);
  });

  describe("the decision check itself (documents derived from this one)", () => {
    const filled = (rows: string[][], decision = "no change") =>
      setDecision(withRuns(DOC, rows), decision);

    it("accepts small numbers with no change", () => {
      expect(shapeProblems(filled(SMALL))).toEqual([]);
      expect(decisionProblems(filled(SMALL))).toEqual([]);
    });

    it("refuses no change after a provider_timeout run", () => {
      const md = filled([...SMALL, ["3", "provider_timeout", "150", "pending", "90000", "high"]]);
      expect(shapeProblems(md)).toEqual([]);
      expect(decisionProblems(md)).toEqual(["no change is refused: run 3: provider_timeout"]);
    });

    it("refuses no change after an output_truncated run", () => {
      const md = filled([...SMALL, ["3", "output_truncated", "150", "36000", "80000", "high"]]);
      expect(decisionProblems(md)).toEqual(["no change is refused: run 3: output_truncated"]);
    });

    it("refuses no change when tokens per line project exactly to the ceiling, accepts one token less", () => {
      const at = ["3", "ok", "10", String(PER_LINE_TOKENS * 10), "1000", "high"];
      expect(decisionProblems(filled([...SMALL, at]))).toEqual([
        "no change is refused: tokens per line projected to the token ceiling",
      ]);
      const below = ["3", "ok", "10", String(PER_LINE_TOKENS * 10 - 1), "1000", "high"];
      expect(decisionProblems(filled([...SMALL, below]))).toEqual([]);
    });

    it("refuses no change when milliseconds per line project exactly to the timeout, accepts one less", () => {
      const at = ["3", "ok", "10", "100", String(PER_LINE_MS * 10), "high"];
      expect(decisionProblems(filled([...SMALL, at]))).toEqual([
        "no change is refused: milliseconds per line projected to the request timeout",
      ]);
      const below = ["3", "ok", "10", "100", String(PER_LINE_MS * 10 - 1), "high"];
      expect(decisionProblems(filled([...SMALL, below]))).toEqual([]);
    });

    it("refuses no change with no ok run, and with an ok run that lacks a number", () => {
      expect(
        decisionProblems(filled([["1", "provider_unavailable", "5", "pending", "300", "high"]])),
      ).toEqual(["no change, but there is no ok run"]);
      expect(decisionProblems(filled([["1", "ok", "5", "pending", "300", "high"]]))).toEqual([
        "no change, but an ok run lacks lines, tokens or milliseconds",
      ]);
    });

    it("refuses no change while a run's outcome is pending (it could hide a timeout)", () => {
      const md = filled([...SMALL, ["3", "pending", "180", "pending", "pending", "pending"]]);
      expect(shapeProblems(md)).toEqual([]);
      expect(decisionProblems(md)).toEqual(["no change, but a run's outcome is still pending"]);
    });

    it("refuses an effort that is not a known value or pending (no free text)", () => {
      expect(shapeProblems(filled([["1", "ok", "5", "5", "5", "invoice 4711"]]))).toEqual([
        "row 1: bad effort invoice 4711",
      ]);
      expect(shapeProblems(filled([["1", "ok", "5", "5", "5", "medium"]]))).toEqual([]);
    });

    it("refuses pending when no cell is pending, accepts it while one is", () => {
      expect(decisionProblems(filled(SMALL, "pending"))).toEqual([
        "pending, but no cell is pending",
      ]);
      expect(
        decisionProblems(
          filled(
            [...SMALL, ["3", "pending", "pending", "pending", "pending", "pending"]],
            "pending",
          ),
        ),
      ).toEqual([]);
    });

    it("accepts change with a reason, refuses it without one", () => {
      expect(decisionProblems(filled(SMALL, "change: tokens per line"))).toEqual([]);
      expect(decisionProblems(filled(SMALL, "change:"))).toEqual([
        "bad decision: Decision: change:",
      ]);
      expect(decisionProblems(filled(SMALL, "maybe"))).toEqual(["bad decision: Decision: maybe"]);
    });

    it("refuses a malformed table: a forbidden column, a bad outcome, a bad number", () => {
      expect(shapeProblems(DOC.replace("| effort |", "| effort | requestId |"))).not.toEqual([]);
      expect(shapeProblems(filled([["1", "fine", "1", "1", "1", "high"]]))).toEqual([
        "row 1: bad outcome fine",
      ]);
      expect(shapeProblems(filled([["1", "ok", "1.5", "1", "1", "high"]]))).toEqual([
        "row 1: bad cell 1.5",
      ]);
    });

    it("the secret check finds a secret-like string in a derived document", () => {
      expect(DOC + "\nsk-ant-abc").toMatch(SECRET);
    });
  });
});
