// SP0 spike (§3.5, S1): run before the first connector call.
//   npx tsx scripts/spike/sp00-ref-check.ts <project ref>
// Prints `ok` and exits 0 only for the declared temporary project (SPIKE_PROJECT_REF); the staging ref is refused by name.
import { checkConnectorRef } from "../lib/sp00/target";

const ref = process.argv[2];
if (process.argv.length !== 3 || ref === undefined) {
  console.error("Usage: npx tsx scripts/spike/sp00-ref-check.ts <project ref>");
  process.exit(1);
}
try {
  checkConnectorRef(ref, process.env);
  console.log("ok");
} catch (error) {
  console.error(error instanceof Error ? error.message : "ref check failed");
  process.exit(1);
}
