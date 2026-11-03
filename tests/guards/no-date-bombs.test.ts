import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Date-bomb guard. A fixture fired at a fixed instant (2026-11-03 20:00Z) next to a reader of the
// REAL clock (kitchen_tickets(), now(), new Date()) passes for months and then goes red on the
// day the real clock reaches the fixture. CI broke that way on 2026-11-03 (pgTAP 175), and 225
// was due on 2026-11-04.
//
// Rule: a test file that reads the real clock must not hold a literal date (YYYY-MM-DD, with or
// without a time) within +-400 days of the day the test runs. The window is relative to
// `new Date()`, so a fixture that is safe today is caught as soon as it comes close. Move such
// dates years back (the fakes use 1998-2000, 28 years earlier: same weekdays, leap years and
// Europe/Rome clock changes), or, only when moving them would make the test meaningless, put a
// marker comment with a reason on a line of its own:
//   -- clock-pinned: <reason>      (SQL)
//   // clock-pinned: <reason>      (TypeScript)
// Use the marker only when every assertion that depends on the real clock is independent of the
// fixed dates. Migrations are not tests and are not scanned.

const WINDOW_DAYS = 400;
const DAY_MS = 86_400_000;

// A reader of the real clock or of the real current business day. Public readers that take no
// argument (kitchen_tickets(), dashboard_summary()) read it internally.
const SQL_CLOCK =
  /\b(?:now\s*\(\s*\)|clock_timestamp|statement_timestamp|transaction_timestamp|current_date|current_timestamp|localtimestamp|business_date\s*\()|\bpublic\.\w+\(\s*\)/i;
const TS_CLOCK = /new Date\(\s*\)|Date\.now\(/;

const DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?/g;

type Finding = { line: number; text: string };
type Verdict =
  | { status: "ok" }
  | { status: "pinned"; reason: string }
  | { status: "no-clock" }
  | { status: "bad-marker"; line: number }
  | { status: "bomb"; hits: Finding[] };

function markerRegex(isSql: boolean): RegExp {
  return isSql ? /^\s*--\s*clock-pinned:(.*)$/ : /^\s*\/\/\s*clock-pinned:(.*)$/;
}

// The code of a line: comments and documentation paths (docs/plans/2026-10-24-x.md) removed.
function codeOf(line: string, isSql: boolean): string {
  let code = line;
  if (isSql) code = code.replace(/--.*$/, "");
  else if (/^\s*(?:\/\/|\/\*|\*)/.test(code)) code = "";
  else code = code.replace(/\s\/\/\s.*$/, "");
  return code.replace(/docs\/(?:plans|adr)\/\S+/g, "");
}

function inWindow(year: number, month: number, day: number, now: Date): boolean {
  const date = Date.UTC(year, month - 1, day);
  if (new Date(date).getUTCDate() !== day) return false; // not a calendar date
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.abs(date - today) <= WINDOW_DAYS * DAY_MS;
}

function judge(source: string, isSql: boolean, now: Date): Verdict {
  const lines = source.split("\n");
  const marker = markerRegex(isSql);
  let reason: string | null = null;
  let badMarker = 0;
  const clock = isSql ? SQL_CLOCK : TS_CLOCK;
  let readsClock = false;
  const hits: Finding[] = [];
  lines.forEach((text, index) => {
    const found = marker.exec(text);
    if (found) {
      if (found[1]?.trim()) reason ??= found[1].trim();
      else badMarker ||= index + 1;
      return;
    }
    const code = codeOf(text, isSql);
    if (clock.test(code)) readsClock = true;
    for (const m of code.matchAll(DATE)) {
      if (inWindow(Number(m[1]), Number(m[2]), Number(m[3]), now)) {
        hits.push({ line: index + 1, text: m[0] });
      }
    }
  });
  if (hits.length === 0) return { status: "ok" };
  if (!readsClock) return { status: "no-clock" };
  if (reason !== null) return { status: "pinned", reason };
  if (badMarker) return { status: "bad-marker", line: badMarker };
  return { status: "bomb", hits };
}

function listFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(dir, entry.name));
}

function testFiles(root: string): string[] {
  return [
    ...listFiles(join(root, "supabase/tests/database"), /\.test\.sql$/),
    ...listFiles(join(root, "tests/integration"), /\.int\.ts$/),
    ...listFiles(join(root, "e2e"), /\.spec\.ts$/),
    ...listFiles(join(root, "e2e/helpers"), /\.ts$/),
  ];
}

function isoDay(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

describe("no date bombs in tests that read the real clock", () => {
  const now = new Date();
  const soon = isoDay(now, 10);
  const longAgo = isoDay(now, -500);

  it("catches a fixture with a date 10 days from now next to now()", () => {
    const sql = `insert into t values ('${soon} 20:00:00+00');\nselect now();`;
    expect(judge(sql, true, now).status).toBe("bomb");
    const ts = `const fired = "${soon}T20:00:00Z";\nconst n = new Date();`;
    expect(judge(ts, false, now).status).toBe("bomb");
  });

  it("catches the date window at both edges and a bare date, not a time-less lookalike", () => {
    expect(judge(`select '${isoDay(now, 399)}', now();`, true, now).status).toBe("bomb");
    expect(judge(`select '${isoDay(now, -399)}', now();`, true, now).status).toBe("bomb");
    expect(judge(`select '${isoDay(now, 401)}', now();`, true, now).status).toBe("ok");
    expect(judge(`select '2026-13-45', now();`, true, now).status).toBe("ok");
  });

  it("catches a public reader without arguments as a clock read", () => {
    expect(judge(`select '${soon}'; select public.kitchen_tickets();`, true, now).status).toBe(
      "bomb",
    );
  });

  it("ignores a date 500 days ago", () => {
    const sql = `insert into t values ('${longAgo} 20:00:00+00');\nselect now();`;
    expect(judge(sql, true, now)).toEqual({ status: "ok" });
  });

  it("ignores dates in comments and in docs paths", () => {
    const sql = `-- fixed on ${soon}, see docs/plans/${soon}-x.md\nselect now();`;
    expect(judge(sql, true, now)).toEqual({ status: "ok" });
  });

  it("ignores a file that does not read the clock", () => {
    expect(judge(`insert into t values ('${soon}');`, true, now)).toEqual({ status: "no-clock" });
  });

  it("accepts a file with the marker and a reason", () => {
    const sql = `-- clock-pinned: a test about the current week\ninsert into t values ('${soon}');\nselect now();`;
    expect(judge(sql, true, now)).toEqual({
      status: "pinned",
      reason: "a test about the current week",
    });
    const ts = `// clock-pinned: the page shows the current week\nconst d = "${soon}"; const n = new Date();`;
    expect(judge(ts, false, now).status).toBe("pinned");
  });

  it("rejects a marker with no reason", () => {
    const sql = `-- clock-pinned:\ninsert into t values ('${soon}');\nselect now();`;
    expect(judge(sql, true, now)).toEqual({ status: "bad-marker", line: 1 });
    const blank = `-- clock-pinned:    \ninsert into t values ('${soon}');\nselect now();`;
    expect(judge(blank, true, now).status).toBe("bad-marker");
  });

  it("does not take a marker of the other language or in the middle of a line", () => {
    const wrongLanguage = `// clock-pinned: reason\ninsert into t values ('${soon}');\nselect now();`;
    expect(judge(wrongLanguage, true, now).status).toBe("bomb");
    const trailing = `insert into t values ('${soon}'); -- clock-pinned: reason\nselect now();`;
    expect(judge(trailing, true, now).status).toBe("bomb");
  });

  it("finds the scanned test files", () => {
    const files = testFiles(process.cwd());
    expect(files.some((f) => f.endsWith("225_kitchen_board.test.sql"))).toBe(true);
    expect(files.some((f) => f.includes("e2e/helpers/"))).toBe(true);
    expect(files.some((f) => f.includes("/migrations/"))).toBe(false);
  });

  it("no test file that reads the real clock holds a date within 400 days of today", () => {
    const offences: string[] = [];
    for (const file of testFiles(process.cwd())) {
      const verdict = judge(readFileSync(file, "utf8"), file.endsWith(".sql"), now);
      const name = file.slice(process.cwd().length + 1);
      if (verdict.status === "bomb") {
        const sample = verdict.hits.slice(0, 3).map((h) => `${h.line}: ${h.text}`);
        offences.push(`${name} (${verdict.hits.length} dates; ${sample.join(", ")})`);
      } else if (verdict.status === "bad-marker") {
        offences.push(`${name}:${verdict.line} clock-pinned marker without a reason`);
      }
    }
    expect(offences).toEqual([]);
  });
});
