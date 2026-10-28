// Demo data: fills a fake osteria week, or removes it before go-live (docs/plans/2026-10-24-demo-data.md).
//   npm run demo -- --tenant <uuid>             fill the EXISTING tenant with the demo data (local stack)
//   npm run demo -- --tenant <uuid> --reset     reset the tenant's operational data (it must carry demo data), then seed again
//   npm run demo -- --tenant <uuid> --purge     reset it, remove the demo users' Auth accounts and the fake PDFs
//   npm run demo -- --cleanup                   only finish the Auth and Storage clean-up of earlier resets
//   --force skips this script's own "the tenant holds data" check; the database still refuses (it cannot be skipped).
//   DEMO_STAGING_OK=yes npm run demo -- --target staging --tenant <uuid>
// Prints one JSON line of counts and masked identities. The logic is in scripts/lib/demo/main.ts.
import { main } from "../lib/demo/main";

process.exit(
  await main({
    argv: process.argv.slice(2),
    env: process.env,
    now: () => new Date(),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  }),
);
