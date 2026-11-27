import { randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "./mfa";

// Helpers of the memberships suite (tests/integration/memberships.int.ts, SP2 S7). Fake data only: every address is @example.test, every password is
// made at run time, every VAT number is random.

const fakeVat = () => `IT${String(randomInt(0, 1e11)).padStart(11, "0")}`;

/** One e-mail login that owns two venues, "Osteria Demo A" and "Osteria Demo B" (two memberships, SP2 S3). */
export async function createTwoVenueOwner(admin: SupabaseClient) {
  const email = `owner+${randomUUID().slice(0, 8)}@example.test`;
  const password = `prova ${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const authId = created.data.user?.id;
  if (created.error || !authId) throw new Error(`Fixture failed: owner: ${created.error?.message}`);
  const tenant = async (name: string): Promise<string> => {
    const { data, error } = await admin.rpc("create_tenant_with_owner", {
      tenant_name: name,
      tenant_vat_number: fakeVat(),
      owner_auth_id: authId,
      owner_display_name: "Titolare Demo",
    });
    if (error || typeof data !== "string")
      throw new Error(`Fixture failed: ${name}: ${error?.message}`);
    return data;
  };
  const tenantA = await tenant("Osteria Demo A");
  const tenantB = await tenant("Osteria Demo B");
  const { data: row, error } = await admin
    .from("app_user")
    .select("id")
    .eq("auth_id", authId)
    .eq("tenant_id", tenantA)
    .single();
  if (error || !row) throw new Error(`Fixture failed: app_user id: ${error?.message}`);
  const owner: Account = { role: "owner", authId, appUserId: row.id as string, email, password };
  return { owner, tenantA, tenantB };
}
