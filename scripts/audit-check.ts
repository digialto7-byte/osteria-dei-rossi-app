// AT3 (M25 step 5): fails on a high or critical npm advisory that has no valid exception.
//   npx tsx scripts/audit-check.ts
// Exceptions: docs/go-live/audit-exceptions.json (package, advisory, reason, reviewBy, devOnly).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { evaluateAudit, parseExceptions, type AuditReport } from "./lib/audit-check";

const EXCEPTIONS_PATH = new URL("../docs/go-live/audit-exceptions.json", import.meta.url);

type Deps = {
  now: Date;
  readExceptions: () => string;
  /** Runs `npm <args>` and returns its stdout (npm exits non-zero when it finds advisories). */
  audit: (args: string[]) => string;
  write: (text: string) => void;
  writeError: (text: string) => void;
};

function parseReport(text: string): AuditReport {
  const report = JSON.parse(text) as AuditReport;
  if (typeof report !== "object" || report === null || typeof report.vulnerabilities !== "object") {
    throw new Error("not an audit report");
  }
  return report;
}

export function runAuditCheck(deps: Deps): number {
  let failures: string[];
  try {
    const exceptions = parseExceptions(JSON.parse(deps.readExceptions()));
    const all = parseReport(deps.audit(["audit", "--json"]));
    const prod = parseReport(deps.audit(["audit", "--omit=dev", "--json"]));
    failures = evaluateAudit(all, prod, exceptions, deps.now.toISOString().slice(0, 10));
  } catch {
    deps.writeError("audit-check: could not read the exceptions file or the npm audit report.");
    return 1;
  }
  if (failures.length === 0) {
    deps.write("audit-check: no unexcepted high or critical advisory.");
    return 0;
  }
  for (const failure of failures) deps.writeError(`audit-check: ${failure}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runAuditCheck({
    now: new Date(),
    readExceptions: () => readFileSync(EXCEPTIONS_PATH, "utf8"),
    audit: (args) =>
      spawnSync("npm", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout,
    write: (text) => process.stdout.write(`${text}\n`),
    writeError: (text) => console.error(text),
  });
}
