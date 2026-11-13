// Sets the second-factor mode of a tenant (P2-1, founder step M-5). Run with the secret key in the local environment, from the founder's trusted machine:
//   npx tsx scripts/set-mfa-enforcement.ts --tenant <tenant id> --mode required --actor <admin app_user id>
// `--mode off` is the kill switch; `--mode enrolled` returns to the grace state. `required` is refused until every active admin has a verified factor.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runSetMfaEnforcement, type MfaAdminClient } from "./lib/mfa-admin";

process.exit(
  await runSetMfaEnforcement(process.argv.slice(2), {
    admin: () => createSupabaseAdminClient() as unknown as MfaAdminClient,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }),
);
