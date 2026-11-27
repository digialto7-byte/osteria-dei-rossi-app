import { randomUUID } from "node:crypto";
import { admin } from "./seed-invoice";
import { fakeEmail, fakeVat } from "./session";

/**
 * SP2 AT7 fixture: one e-mail login with a password that owns two venues (two memberships), through the local stack's secret key like `createStaff`.
 * Fake data only; the password is made at run time and never stored. The venue names differ, so a screen shows which venue it is in.
 */
export const VENUE_A = "Locale Alfa Demo";
export const VENUE_B = "Locale Beta Demo";

export async function createTwoVenueOwner(): Promise<{
  email: string;
  password: string;
  tenantA: string;
  tenantB: string;
}> {
  const db = admin();
  const email = fakeEmail("owner");
  const password = `frase di prova ${randomUUID()}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  const authId = created.data.user?.id;
  if (created.error || !authId) throw new Error("Fixture failed: two-venue owner");
  const venue = async (name: string): Promise<string> => {
    const { data, error } = await db.rpc("create_tenant_with_owner", {
      tenant_name: name,
      tenant_vat_number: fakeVat(),
      owner_auth_id: authId,
      owner_display_name: "Titolare Demo",
    });
    if (error || typeof data !== "string") throw new Error(`Fixture failed: ${name}`);
    return data;
  };
  return { email, password, tenantA: await venue(VENUE_A), tenantB: await venue(VENUE_B) };
}
