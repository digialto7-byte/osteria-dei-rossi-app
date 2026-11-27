// Creates a tenant and its owner. The data comes from the environment, never from arguments (they show in process listings and logs):
//   TENANT_NAME="Osteria Demo" TENANT_VAT_NUMBER=IT00000000000 OWNER_EMAIL=owner@example.test OWNER_NAME="Titolare Demo" npm run create-tenant
// In production it runs as the `create-tenant` job of the platform-ops workflow, where those four are environment secrets (SP3 plan section 3.13).
// Prints the tenant id only: in full on a developer's machine, masked first and cut to 8 characters under GitHub Actions. Errors are codes, never values.
// The one allowed argument is `--ids-out <path>`: the two full ids (tenant and owner) as JSON in a new file, mode 0600, created exclusively. Callers on a throwaway
// stack (the backup self-test, the e2e helper) read the ids from it; platform-ops never passes it.
// SP2 S9: `--existing-owner-id <uuid>` gives a new tenant to an existing login (a second membership). OWNER_EMAIL must then be unset; no auth user is
// created, and none is deleted when the tenant cannot be made.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runCreateTenant } from "./lib/create-tenant";

process.exit(
  await runCreateTenant(process.argv.slice(2), process.env, {
    admin: () => createSupabaseAdminClient(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }),
);
