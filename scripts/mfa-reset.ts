// Break-glass reset of an owner's or admin's second factor (P2-1, plan D2; founder decision Q-T1 = V1: there is no reset in the app). DigiAlto runs it after
// confirming the person by phone. Run with the secret key in the local environment:
//   npx tsx scripts/mfa-reset.ts --user <app_user id of the person> --actor <admin app_user id of the same venue>
// The audit event app_user.mfa_reset is written before anything changes; the person is signed out everywhere and enrols again at the next sign-in.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runMfaReset, type MfaAdminClient } from "./lib/mfa-admin";

process.exit(
  await runMfaReset(process.argv.slice(2), {
    admin: () => createSupabaseAdminClient() as unknown as MfaAdminClient,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }),
);
