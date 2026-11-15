// DigiAlto's platform admin script (SP3 plan section 3.9.1). Runs only as a job of the platform-ops workflow, with the secret key in the job's environment:
//   npx tsx scripts/platform-admin.ts bootstrap [--auth-id <uuid>]
// `bootstrap` makes the platform admin account the one active platform_admin. The account is found by the environment secret PLATFORM_ADMIN_EMAIL unless --auth-id is given;
// the address is never printed. Prints {authId, hasVerifiedFactor}: under GitHub Actions the id is masked first and cut to 8 characters. Errors are codes, never values.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runPlatformAdmin, type PlatformAdminClient } from "./lib/platform-admin";

process.exit(
  await runPlatformAdmin(process.argv.slice(2), process.env, {
    admin: () => createSupabaseAdminClient() as unknown as PlatformAdminClient,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }),
);
