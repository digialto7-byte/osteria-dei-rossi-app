import { expect, type Page } from "@playwright/test";
import { admin } from "./seed-invoice";
import { freshCode } from "./totp";

// P2-1 B8: helpers for the end-to-end TOTP flow. The codes come from e2e/helpers/totp.ts (A14), so no authenticator app is needed. Enforcement is set with the
// LOCAL stack's secret key (service role), the one way the app never offers (Q-T1 = V1: there is no in-app reset either). Fake data only.

/** The app_user id of the first active member of a role (the script's `--actor`, or the account to reset). */
export async function appUserId(tenantId: string, role: "owner" | "admin"): Promise<string> {
  const row = await admin()
    .from("app_user")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("role", role)
    .eq("is_active", true)
    .limit(1)
    .single();
  if (row.error || !row.data) throw new Error(`no active ${role} in tenant`);
  return row.data.id as string;
}

/** Sets the tenant's enforcement through public.set_mfa_enforcement as the service role (the founder's M-5 step). */
export async function setEnforcement(
  tenantId: string,
  mode: "off" | "enrolled" | "required",
  actor: string,
): Promise<{ changed: boolean; mode: string }> {
  const { data, error } = await admin().rpc("set_mfa_enforcement", {
    p_tenant: tenantId,
    p_mode: mode,
    p_actor: actor,
  });
  if (error) throw new Error(`set_mfa_enforcement: ${error.message}`);
  return data as { changed: boolean; mode: string };
}

/**
 * A device that remembers which TOTP step it has already spent, so the next code is always a fresh one (Supabase refuses a code reused for the same factor). One
 * instance per authenticator secret; the secret is read off the enrolment page, never from the database.
 */
export class Authenticator {
  private lastStep: number | null = null;
  constructor(readonly secret: string) {}
  async code(): Promise<string> {
    const { code, step } = await freshCode(this.secret, this.lastStep);
    this.lastStep = step;
    return code;
  }
}

/** The base32 key the enrolment screen shows ("JBSW Y3DP …") with its spaces removed, as an authenticator would store it. */
export async function readSetupKey(page: Page): Promise<string> {
  const field = page.getByLabel("Chiave di configurazione", { exact: true });
  await expect(field).toBeVisible();
  return ((await field.inputValue()) ?? "").replace(/\s+/g, "");
}

/**
 * Drives one step of the enrolment component that is already on screen: reads the key, types a fresh code and presses "Attiva". Returns an Authenticator that keeps
 * generating fresh codes for this factor (the sign-in challenge reuses it).
 */
export async function enrolOnScreen(page: Page): Promise<Authenticator> {
  const secret = await readSetupKey(page);
  const device = new Authenticator(secret);
  await page.getByLabel("Codice di 6 cifre", { exact: true }).fill(await device.code());
  await page.getByRole("button", { name: "Attiva", exact: true }).click();
  return device;
}

/** Fills and submits the sign-in code on /login/codice with a fresh code from `device`. */
export async function passChallenge(page: Page, device: Authenticator): Promise<void> {
  await page.getByLabel("Codice di 6 cifre", { exact: true }).fill(await device.code());
  await page.getByRole("button", { name: "Verifica", exact: true }).click();
}
