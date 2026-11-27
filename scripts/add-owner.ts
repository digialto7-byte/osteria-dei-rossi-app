// Adds an e-mail owner login to an EXISTING tenant (SP3 PR 1, lead decision 2026-11-27), with the secret key:
//   npx tsx scripts/add-owner.ts --tenant <uuid> --email <address> --name <display name>
// The login is created (e-mail, confirmed, no password) or reused when it is a member of no venue; then the owner row and one platform audit row
// (script.add_owner) are written. Prints only 8-character id prefixes, never the address. Errors are codes, never values.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runAddOwner, type AddOwnerClient } from "./lib/add-owner";

process.exit(
  await runAddOwner(process.argv.slice(2), process.env, {
    admin: () => createSupabaseAdminClient() as unknown as AddOwnerClient,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }),
);
