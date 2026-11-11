// CI diagnostics for a failed Playwright run (the report artifact cannot always be downloaded):
//   npx tsx scripts/ci/print-trace-tail.ts [test-results]
// Prints, for each test-results/**/trace.zip, the last actions, events and console messages, redacted (see ../lib/trace-tail.ts).
// Always exits 0: a diagnostic must not change the job's result.
import { printTraceTails } from "../lib/trace-tail";

try {
  printTraceTails(process.argv[2] ?? "test-results", (line) => console.log(line));
} catch (error) {
  console.log(`print-trace-tail failed: ${error instanceof Error ? error.name : "unknown error"}`);
}
