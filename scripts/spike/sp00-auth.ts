// SP0 spike (docs/plans/2026-11-14-sp00-spike.md §3.5, S11): the Auth checks T5, T1, T2, T3, against the local stack or the one declared
// temporary project. One JSON line per check, no secret in it.
//   npx tsx scripts/spike/sp00-auth.ts --target local|temp [--checks preflight,t5,t1,t2,t3]
// Environment variable names: SPIKE_SUPABASE_URL, SPIKE_PUBLISHABLE_KEY and the secret key variable of scripts/lib/sp00/clients.ts (a placeholder on the hosted run), and for the
// temporary project SPIKE_TEMP_OK=yes and SPIKE_PROJECT_REF; E2E_MAILPIT_URL locally. Exit 0 only if every requested check passed.
import { runAuthEntry } from "../lib/sp00/auth-entry";
import { buildAuthContext } from "../lib/sp00/wiring";

process.exit(
  await runAuthEntry({
    argv: process.argv.slice(2),
    env: process.env,
    buildContext: buildAuthContext,
    print: (line) => console.log(line),
    printError: (message) => console.error(message),
  }),
);
