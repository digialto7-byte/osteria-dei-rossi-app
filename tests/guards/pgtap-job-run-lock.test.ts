import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// pgTAP and the job_run cron race (main CI run 44290312834, 046_alert_rules: "have: 1 / want: 0"). The local stack runs the real
// pg_cron jobs (alert-rules at minute 0, kpi-rollup every 15 minutes, and the nightly ones), so a job can commit an app.job_run row
// while a pgTAP file is running; under read committed the file then counts one run too many. Every pgTAP file that reads
// app.job_run takes `lock table app.job_run in share row exclusive mode` right after `begin;`: other sessions' inserts wait until the
// file rolls back, and reads are unaffected. A file that only calls app.job_run_begin/_end (a writer that counts nothing) is not a
// reader. Comment lines are ignored.
// The lock alone is not enough (main CI run 44330126035, #183): the cron row can be COMMITTED just before the file starts (alert-rules at
// 15:00:00, 046 at 15:00:12), and the file counts every row. So the second statement is `delete from app.job_run;`: the file starts from
// an empty table inside its own transaction, and the rollback puts every row back. No foreign key points at app.job_run.
const DIR = join(__dirname, "..", "..", "supabase", "tests", "database");
const LOCK = "lock table app.job_run in share row exclusive mode;";
const CLEAN = "delete from app.job_run;";
const READS = /\bapp\.job_run\b/;

/** Why a pgTAP file's text breaks the rule, or null when it keeps it. */
export function jobRunLockProblem(text: string): string | null {
  const lines = text.split("\n");
  const firstRead = lines.findIndex(
    (line) => !line.trimStart().startsWith("--") && READS.test(line),
  );
  if (firstRead < 0) return null;
  const begin = lines.indexOf("begin;");
  if (begin < 0) return "reads app.job_run but has no `begin;` line";
  const lock = lines.findIndex((line, i) => i > begin && line.trim() === LOCK);
  if (lock < 0) return "reads app.job_run without the lock line after `begin;`";
  if (lock > firstRead)
    return `the lock line (${lock + 1}) comes after the first read of app.job_run (${firstRead + 1})`;
  const between = lines
    .slice(begin + 1, lock)
    .filter((l) => l.trim() !== "" && !l.trimStart().startsWith("--"));
  if (between.length > 0) return "the lock line must be the first statement after `begin;`";
  const next = lines.findIndex(
    (l, i) => i > lock && l.trim() !== "" && !l.trimStart().startsWith("--"),
  );
  if (next < 0 || lines[next]!.trim() !== CLEAN)
    return "the statement right after the lock must be `delete from app.job_run;` (a cron row committed before the file started)";
  return null;
}

describe("pgTAP files that read app.job_run lock it first", () => {
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  it.each(files)("%s", (name) => {
    expect(jobRunLockProblem(readFileSync(join(DIR, name), "utf8"))).toBeNull();
  });

  it("covers the files that read app.job_run (the list grows only with new readers)", () => {
    const readers = files.filter((name) =>
      readFileSync(join(DIR, name), "utf8")
        .split("\n")
        .some((line) => !line.trimStart().startsWith("--") && READS.test(line)),
    );
    expect(readers.length).toBeGreaterThanOrEqual(16);
    expect(readers).toContain("046_alert_rules.test.sql");
    expect(readers).toContain("232_kpi_rollup.test.sql");
  });

  describe("the rule itself", () => {
    const head = "begin;\ncreate extension if not exists pgtap with schema extensions;\n";
    it("a file that never reads app.job_run passes, and so does one that only calls job_run_begin", () => {
      expect(jobRunLockProblem("begin;\nselect 1;\n")).toBeNull();
      expect(jobRunLockProblem("begin;\nselect app.job_run_begin('kpi-rollup');\n")).toBeNull();
      expect(
        jobRunLockProblem("-- reads app.job_run in a comment only\nbegin;\nselect 1;\n"),
      ).toBeNull();
    });
    it("a reader without the lock fails", () => {
      expect(jobRunLockProblem(`${head}select count(*) from app.job_run;\n`)).toMatch(
        /without the lock/,
      );
    });
    it("a lock after the first read fails", () => {
      expect(jobRunLockProblem(`begin;\nselect count(*) from app.job_run;\n${LOCK}\n`)).toMatch(
        /comes after/,
      );
    });
    it("a statement between begin and the lock fails", () => {
      expect(jobRunLockProblem(`${head}${LOCK}\nselect count(*) from app.job_run;\n`)).toMatch(
        /first statement/,
      );
    });
    it("the lock then the clean slate, right after begin, passes, with comments in between", () => {
      expect(
        jobRunLockProblem(
          `begin;\n-- why\n${LOCK}\n-- and why\n${CLEAN}\nselect count(*) from app.job_run;\n`,
        ),
      ).toBeNull();
    });
    it("the lock without the clean slate right after it fails (a row committed before the file started)", () => {
      expect(jobRunLockProblem(`begin;\n${LOCK}\nselect count(*) from app.job_run;\n`)).toMatch(
        /delete from app\.job_run/,
      );
      expect(
        jobRunLockProblem(
          `begin;\n${LOCK}\nselect 1;\n${CLEAN}\nselect count(*) from app.job_run;\n`,
        ),
      ).toMatch(/right after the lock/);
    });
  });
});
