// Demo data: fills a fake osteria week, or removes it before go-live (docs/plans/2026-10-24-demo-data.md).
//   npm run demo                      seed the LOCAL stack
//   npm run demo -- --reset           purge the demo, then seed it again
//   npm run demo -- --purge           purge the demo tenant, then remove its Auth users and Storage objects
//   npm run demo -- --cleanup         only finish the Auth and Storage clean-up of earlier purges
//   DEMO_STAGING_OK=yes npm run demo -- --target staging     (also needs DEMO_OWNER_EMAIL)
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
