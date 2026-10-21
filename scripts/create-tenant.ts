// Creates a tenant and its owner. Run with the secret key in the local environment:
//   npm run create-tenant -- --name "Osteria Demo" --vat IT00000000000 \
//     --owner-email owner@example.test --owner-name "Titolare Demo"
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTenant, parseCreateTenantArgs } from "./lib/create-tenant";

try {
  const input = parseCreateTenantArgs(process.argv.slice(2));
  const tenantId = await createTenant(createSupabaseAdminClient(), input);
  // Only the id: no names or emails in logs.
  console.log(tenantId);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
