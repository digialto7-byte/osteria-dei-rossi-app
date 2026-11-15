// Creates a tenant and its owner. The data comes from the environment, never from arguments (they show in process listings and logs):
//   TENANT_NAME="Osteria Demo" TENANT_VAT_NUMBER=IT00000000000 OWNER_EMAIL=owner@example.test OWNER_NAME="Titolare Demo" npm run create-tenant
// In production it runs as the `create-tenant` job of the platform-ops workflow, where those four are environment secrets (SP3 plan section 3.13).
// Prints the tenant id only: in full on a developer's machine, masked first and cut to 8 characters under GitHub Actions. Errors are codes, never values.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  assertNoArguments,
  createIdDisplay,
  createTenant,
  readCreateTenantEnv,
} from "./lib/create-tenant";

try {
  assertNoArguments(process.argv.slice(2));
  const input = readCreateTenantEnv(process.env);
  const display = createIdDisplay(process.env, (line) => console.log(line));
  const tenantId = await createTenant(createSupabaseAdminClient(), input, display);
  console.log(display.reveal(tenantId));
} catch (error) {
  console.error(error instanceof Error ? error.message : "unknown_error");
  process.exit(1);
}
