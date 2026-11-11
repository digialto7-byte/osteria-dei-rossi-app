import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LABELS } from "../../scripts/lib/perf-order-entry";
import { buildCsp } from "../../src/lib/security/csp";

// M25 step 21 (the founder's requirement): docs/go-live/csp-impact.md holds the method, the estimate inputs, the stop rule and the result slots for
// the cost of rendering every page per request. The measurement happens on staging after the merge (Q235), so every result cell is `pending` today.
// This test checks the document's shape, and refuses a `continue` verdict while a stop condition computed from the document's own numbers holds
// (S1 and S2 from the timing table, S3 from the usage table at Q236's 50%, or a limit warning on the Usage page). It also refuses `pending` once
// no cell is pending. The refusal is proved on documents derived from the real one with numbers filled in, because the real one is still empty.
const ROOT = new URL("../../", import.meta.url).pathname;
const DOC = readFileSync(join(ROOT, "docs/go-live/csp-impact.md"), "utf8");
const CHECKLIST = readFileSync(join(ROOT, "docs/go-live/checklist.md"), "utf8");
const E2E = readFileSync(join(ROOT, "e2e/security-headers.spec.ts"), "utf8");
const SECRET =
  /sb_secret_|sk-ant-|re_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}/;

const HEADINGS = [
  "Build output",
  "Requests per page open",
  "Staging timings",
  "Vercel Hobby usage",
  "Estimate",
  "Verdict",
];
const USAGE_ROWS = [
  "Function invocations",
  "Active CPU",
  "Provisioned memory",
  "Edge requests",
  "ISR reads",
  "ISR writes",
  "Fast data transfer",
];
const STOP_SHARE = 50; // Q236
const TARGET_DASHBOARD_MS = 2000;
const TARGET_ORDER_MS = 300;

function section(md: string, title: string): string {
  const start = md.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`no section ${title}`);
  const rest = md.slice(start + 1);
  const next = rest.slice(3).search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

type Table = { header: string[]; rows: Map<string, string[]> };
function table(md: string, title: string): Table {
  const lines = section(md, title)
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/`/g, "")),
    );
  const [header = [], ...body] = lines;
  return { header, rows: new Map(body.map((cells) => [cells[0]!, cells.slice(1)])) };
}

const isCell = (value: string, decimals: boolean) =>
  value === "pending" || (decimals ? /^\d+(\.\d+)?$/ : /^\d+$/).test(value);
const num = (value: string | undefined) =>
  value !== undefined && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;

type Evaluation = { stops: string[]; anyPending: boolean; verdict: string };
function evaluate(md: string): Evaluation {
  const timings = table(md, "Staging timings");
  const usage = table(md, "Vercel Hobby usage");
  const stops: string[] = [];
  const b0 = (name: string) => num(timings.rows.get(name)?.[0]);
  const a = (name: string) => num(timings.rows.get(name)?.[1]);

  // S1 (M22): cold p95 at or over the target after, under it before; or more loads where the tile never showed.
  const coldB0 = b0("dashboard cold p95");
  const coldA = a("dashboard cold p95");
  if (
    coldA !== null &&
    coldB0 !== null &&
    coldA >= TARGET_DASHBOARD_MS &&
    coldB0 < TARGET_DASHBOARD_MS
  ) {
    stops.push("S1 cold p95");
  }
  const failB0 = b0("dashboard failures");
  const failA = a("dashboard failures");
  if (failA !== null && failB0 !== null && failA > failB0) stops.push("S1 failures");

  // S2 (M18): any of the six p95 at or over 300 ms after while under it before.
  for (const label of LABELS) {
    const before = b0(`${label} p95`);
    const after = a(`${label} p95`);
    if (after !== null && before !== null && after >= TARGET_ORDER_MS && before < TARGET_ORDER_MS) {
      stops.push(`S2 ${label}`);
    }
  }

  // S3 (Hobby): the projection at or over the share of the allowance, computed from the row's own numbers.
  for (const [name, cells] of usage.rows) {
    const allowance = num(cells[0]);
    const projected = num(cells[3]);
    if (allowance && projected !== null && (projected / allowance) * 100 >= STOP_SHARE) {
      stops.push(`S3 ${name}`);
    }
  }
  if (/^Limit warning on the Usage page: yes$/m.test(section(md, "Verdict")))
    stops.push("S3 warning");

  const tables = [
    "Build output",
    "Requests per page open",
    "Staging timings",
    "Vercel Hobby usage",
  ];
  const anyPending = tables.some((title) =>
    [...table(md, title).rows.values()].some((cells) => cells.includes("pending")),
  );
  const verdict = /^Verdict: .+$/m.exec(section(md, "Verdict"))?.[0] ?? "";
  return { stops, anyPending, verdict };
}

/** Problems with the verdict of a document; empty when it is acceptable. */
function verdictProblems(md: string): string[] {
  const verdictLines = section(md, "Verdict").match(/^Verdict: .*$/gm) ?? [];
  if (verdictLines.length !== 1)
    return [`expected exactly one Verdict line, found ${verdictLines.length}`];
  const { stops, anyPending, verdict } = evaluate(md);
  if (!/^Verdict: (pending|continue|stop: .+)$/.test(verdict))
    return [`bad verdict line: ${verdict}`];
  const problems: string[] = [];
  if (verdict === "Verdict: continue" && stops.length > 0) {
    problems.push(`continue is refused while a stop condition holds: ${stops.join(", ")}`);
  }
  if (verdict === "Verdict: pending" && !anyPending)
    problems.push("pending, but no cell is pending");
  if (verdict === "Verdict: continue" && anyPending)
    problems.push("continue, but a cell is still pending");
  return problems;
}

/** The document with the cells of one table row replaced (the first cell names the row). */
function setRow(md: string, name: string, cells: string[]): string {
  const line = new RegExp(`^\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|.*$`, "m");
  if (!line.test(md)) throw new Error(`no row ${name}`);
  return md.replace(line, `| ${name} | ${cells.join(" | ")} |`);
}
const setVerdict = (md: string, value: string) => md.replace(/^Verdict: .*$/m, `Verdict: ${value}`);

/** A document in which every result cell is filled in and nothing holds a stop. */
function filled(): string {
  let md = DOC;
  md = setRow(md, "static", ["10", "2"]);
  md = setRow(md, "dynamic", ["40", "48"]);
  md = setRow(md, "documents", ["12"]);
  md = setRow(md, "RSC requests", ["30"]);
  md = setRow(md, "prefetches", ["20"]);
  for (const [name, b0, a] of [
    ["dashboard cold p50", "900", "1100"],
    ["dashboard cold p95", "1500", "1700"],
    ["dashboard warm p50", "400", "450"],
    ["dashboard warm p95", "800", "900"],
    ["dashboard failures", "0", "0"],
    ...LABELS.map((label) => [`${label} p95`, "120", "125"]),
  ] as [string, string, string][]) {
    md = setRow(md, name, [b0, a]);
  }
  for (const name of USAGE_ROWS) md = setRow(md, name, ["1000", "10", "20", "300", "30"]);
  md = md.replace(/^Limit warning on the Usage page: .*$/m, "Limit warning on the Usage page: no");
  return setVerdict(md, "continue");
}

describe("docs/go-live/csp-impact.md", () => {
  it("has exactly these sections, in this order", () => {
    expect([...DOC.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(HEADINGS);
  });

  // P2-0 step B1: the "Policy as built" block in the intro (no new heading). The policy is recomputed from buildCsp, so the doc cannot drift.
  describe("Policy as built (the intro)", () => {
    const intro = DOC.slice(0, DOC.indexOf("\n## "));
    const policy = buildCsp({
      supabaseOrigin: "https://abc.supabase.co",
      deployment: "production",
      dev: false,
      nonce: "AAAAAAAAAAAAAAAAAAAAAA==",
    });
    const origins = policy.split("; ").flatMap((directive) => {
      const [name, ...tokens] = directive.split(" ");
      return tokens.filter((t) => /^https?:\/\//.test(t)).map((t) => [name, t]);
    });

    it("names the module and the ADR", () => {
      expect(intro).toContain("src/lib/security/csp.ts");
      expect(intro).toContain("ADR-028");
    });

    it("buildCsp puts the project origin in img-src and frame-src and nowhere else", () => {
      expect(origins).toEqual([
        ["img-src", "https://abc.supabase.co"],
        ["frame-src", "https://abc.supabase.co"],
      ]);
    });

    it("the doc's third-party line lists exactly those directives", () => {
      const line = /^Third-party origins in the browser policy: (.+)$/m.exec(intro)?.[1];
      expect(line, "a 'Third-party origins in the browser policy:' line").toBeDefined();
      expect([...line!.matchAll(/`([a-z-]+)`/g)].map((m) => m[1])).toEqual(
        origins.map(([name]) => name),
      );
    });

    it("lists every directive of the production page policy, in order", () => {
      const names = policy.split("; ").map((d) => d.split(" ")[0]);
      const listed = /^Directives \(production page\): (.+)$/m.exec(intro)?.[1];
      expect(listed, "a 'Directives (production page):' line").toBeDefined();
      expect([...listed!.matchAll(/`([a-z-]+)`/g)].map((m) => m[1])).toEqual(names);
    });

    it("every backticked path under src, tests, e2e, scripts or docs exists", () => {
      const paths = [...DOC.matchAll(/`((?:src|tests|e2e|scripts|docs)\/[^`\s]+\.\w+)`/g)].map(
        (m) => m[1]!,
      );
      expect(paths.length).toBeGreaterThan(5);
      for (const path of paths) expect(existsSync(join(ROOT, path)), path).toBe(true);
    });

    it("names every CSP guard test that exists in the repo", () => {
      for (const path of [
        "tests/lib/security/csp.test.ts",
        "tests/lib/security/nonce.test.ts",
        "tests/proxy-csp.test.ts",
        "tests/guards/no-raw-html.test.ts",
        "tests/guards/no-browser-supabase.test.ts",
        "tests/guards/public-page-csp.test.ts",
        "e2e/security-headers.spec.ts",
      ]) {
        expect(intro, path).toContain(`\`${path}\``);
      }
    });
  });

  describe("Build output", () => {
    const build = table(DOC, "Build output");
    it("has static and dynamic rows with before and after cells", () => {
      expect(build.header.slice(1)).toEqual(["before (b215326)", "after"]);
      expect([...build.rows.keys()]).toEqual(["static", "dynamic"]);
      for (const cells of build.rows.values()) {
        expect(cells).toHaveLength(2);
        for (const cell of cells) expect(isCell(cell, false), cell).toBe(true);
      }
    });

    it("says which commit the after column was built from", () => {
      const lines = section(DOC, "Build output").match(/^After commit: [0-9a-f]{7,40}$/gm) ?? [];
      expect(lines).toHaveLength(1);
    });

    it("names the pre-rendered routes after the change, equal to the list the e2e spec pins", () => {
      const pinned = /const PRERENDERED = \[(.*?)\];/.exec(E2E)?.[1];
      expect(pinned).toBeDefined();
      const routes = [...pinned!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      expect(routes).toContain("/manifest.webmanifest");
      const line = /^Pre-rendered routes after: (.+)$/m.exec(section(DOC, "Build output"))?.[1];
      expect(line, "a 'Pre-rendered routes after:' line").toBeDefined();
      expect([...line!.matchAll(/`([^`]+)`/g)].map((m) => m[1])).toEqual(routes);
    });
  });

  describe("Requests per page open", () => {
    const requests = table(DOC, "Requests per page open");
    it("has documents, RSC requests and prefetches, each an integer or pending", () => {
      expect([...requests.rows.keys()]).toEqual(["documents", "RSC requests", "prefetches"]);
      for (const cells of requests.rows.values()) {
        expect(cells).toHaveLength(1);
        expect(isCell(cells[0]!, false)).toBe(true);
      }
    });
    it("says where the counts come from", () => {
      expect(section(DOC, "Requests per page open")).toContain("page-requests.json");
    });
  });

  describe("Staging timings", () => {
    const timings = table(DOC, "Staging timings");
    it("has the dashboard rows and one p95 row per order-entry label, with B0 and A", () => {
      expect(timings.header.slice(1)).toEqual(["B0", "A"]);
      expect([...timings.rows.keys()]).toEqual([
        "dashboard cold p50",
        "dashboard cold p95",
        "dashboard warm p50",
        "dashboard warm p95",
        "dashboard failures",
        ...LABELS.map((label) => `${label} p95`),
      ]);
      for (const [name, cells] of timings.rows) {
        expect(cells, name).toHaveLength(2);
        for (const cell of cells) expect(isCell(cell, false), `${name}: ${cell}`).toBe(true);
      }
    });
  });

  describe("Vercel Hobby usage", () => {
    const usage = table(DOC, "Vercel Hobby usage");
    it("has the seven metrics with allowance, B0, A + 7 days, projected and % of allowance", () => {
      expect(usage.header.slice(1)).toEqual([
        "allowance",
        "B0",
        "A + 7 days",
        "projected",
        "% of allowance",
      ]);
      expect([...usage.rows.keys()]).toEqual(USAGE_ROWS);
      for (const [name, cells] of usage.rows) {
        expect(cells, name).toHaveLength(5);
        for (const cell of cells) expect(isCell(cell, true), `${name}: ${cell}`).toBe(true);
      }
    });
    it("takes the allowances from the account's Usage page, not from this document", () => {
      expect(section(DOC, "Vercel Hobby usage")).toMatch(/Usage page/);
      expect(section(DOC, "Vercel Hobby usage")).toMatch(/projected = .*31\s*\/\s*7/);
    });
  });

  describe("Estimate", () => {
    const estimate = section(DOC, "Estimate");
    it("names Q237's inputs and the polling rates", () => {
      expect(estimate).toContain("Q237");
      expect(estimate).toMatch(/6 devices/);
      expect(estimate).toMatch(/15 open hours/);
      expect(estimate).toMatch(/31 days/);
      for (const rate of ["720", "240", "60"]) expect(estimate).toContain(rate);
    });
  });

  describe("Verdict and the stop rule", () => {
    it("has exactly one verdict line, and today it is pending", () => {
      expect(section(DOC, "Verdict").match(/^Verdict: .*$/gm)).toEqual(["Verdict: pending"]);
      expect(verdictProblems(DOC)).toEqual([]);
    });

    it("states S1 to S4 and Q236's share", () => {
      const verdict = section(DOC, "Verdict");
      for (const rule of ["S1", "S2", "S3", "S4"]) expect(verdict).toContain(rule);
      expect(verdict).toContain("50%");
    });

    it("the checklist repeats the verdict of this document", () => {
      const word = /^Verdict: (pending|continue|stop)/m.exec(section(DOC, "Verdict"))?.[1];
      expect(CHECKLIST.replace(/`/g, "")).toContain(`docs/go-live/csp-impact.md, now ${word}`);
    });

    it("has nothing that looks like a secret", () => {
      expect(DOC).not.toMatch(SECRET);
    });
  });

  describe("the verdict check itself (documents derived from this one with numbers filled in)", () => {
    it("accepts a filled document with no stop condition and the verdict continue", () => {
      expect(evaluate(filled()).stops).toEqual([]);
      expect(verdictProblems(filled())).toEqual([]);
    });

    it("refuses pending once no cell is pending, and continue while a cell is pending", () => {
      expect(verdictProblems(setVerdict(filled(), "pending"))).toEqual([
        "pending, but no cell is pending",
      ]);
      expect(
        verdictProblems(setVerdict(setRow(filled(), "static", ["10", "pending"]), "continue")),
      ).toEqual(["continue, but a cell is still pending"]);
    });

    it("accepts a stop verdict that gives a reason, and refuses a bare one", () => {
      const slow = setRow(filled(), "dashboard cold p95", ["1900", "2100"]);
      expect(verdictProblems(setVerdict(slow, "stop: cold p95 over 2 s"))).toEqual([]);
      expect(verdictProblems(setVerdict(slow, "stop:"))).toEqual([
        "bad verdict line: Verdict: stop:",
      ]);
    });

    describe.each([
      [
        "S1: cold p95 goes from under 2 s to 2 s",
        "dashboard cold p95",
        ["1999", "2000"],
        "S1 cold p95",
      ],
      ["S1: more loads without the tile", "dashboard failures", ["1", "2"], "S1 failures"],
      ["S2: add goes from 299 ms to 300 ms", "add p95", ["299", "300"], "S2 add"],
      ["S2: lines goes from 100 ms to 400 ms", "lines p95", ["100", "400"], "S2 lines"],
      [
        "S3: 50% of the allowance exactly",
        "Active CPU",
        ["1000", "10", "20", "500", "50"],
        "S3 Active CPU",
      ],
      ["S3: 51 of 100", "Edge requests", ["100", "1", "2", "51", "51"], "S3 Edge requests"],
    ])("%s", (_name, row, cells, stop) => {
      it("holds a stop, and continue is refused", () => {
        const md = setRow(filled(), row, cells);
        expect(evaluate(md).stops).toEqual([stop]);
        expect(verdictProblems(md)).toEqual([
          `continue is refused while a stop condition holds: ${stop}`,
        ]);
      });
    });

    it("a limit warning on the Usage page is a stop too", () => {
      const md = filled().replace(
        /^Limit warning on the Usage page: .*$/m,
        "Limit warning on the Usage page: yes",
      );
      expect(evaluate(md).stops).toEqual(["S3 warning"]);
      expect(verdictProblems(md)).toHaveLength(1);
    });

    it.each([
      [
        "a target B0 already missed is reported, not a stop",
        "dashboard cold p95",
        ["2500", "2600"],
      ],
      ["order entry already over 300 ms before", "move p95", ["350", "400"]],
      ["49 of 100 is under the share", "Function invocations", ["100", "1", "2", "49", "49"]],
      ["fewer failures than before", "dashboard failures", ["3", "1"]],
    ])("%s", (_name, row, cells) => {
      const md = setRow(filled(), row, cells);
      expect(evaluate(md).stops).toEqual([]);
      expect(verdictProblems(md)).toEqual([]);
    });
  });
});
