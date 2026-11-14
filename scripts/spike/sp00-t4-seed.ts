// SP0 spike (docs/plans/2026-11-14-sp00-spike.md §3.5, S12): fills the measured tenant "Osteria Demo SP0" for T4 and prints one JSON line with
// its id (for the SQL calls) and the seed counts.
//   npx tsx scripts/spike/sp00-t4-seed.ts --target local|temp
// Environment variable names as sp00-auth.ts. Exit 0 only if the whole seed and the order entry succeeded.
import { runT4SeedEntry } from "../lib/sp00/t4-seed-entry";
import { buildSeedContext } from "../lib/sp00/wiring-t4";

process.exit(
  await runT4SeedEntry({
    argv: process.argv.slice(2),
    env: process.env,
    buildContext: buildSeedContext,
    print: (line) => console.log(line),
    printError: (message) => console.error(message),
  }),
);
