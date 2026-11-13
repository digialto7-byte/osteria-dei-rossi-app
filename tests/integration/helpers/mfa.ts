import { randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { freshCode } from "../../../e2e/helpers/totp";
import { CookieJar, createJarClient } from "./cookie-jar";
import type { StackEnv } from "./stack";

// Helpers of the second-factor suite (tests/integration/mfa.int.ts, P2-1 A15). Fake data only: every address is @example.test, every password is made at run time.
// The TOTP secrets are the ones the local Auth server generates during the run; none is a real credential, and the suite keeps them only to scan the database afterwards.

export interface Account {
  role: "owner" | "admin" | "chef" | "waiter";
  authId: string;
  appUserId: string;
  email: string;
  password: string;
}

const fakeVat = () => `IT${String(randomInt(0, 1e11)).padStart(11, "0")}`;

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) {
    throw new Error(`Fixture failed: ${what}: ${result.error?.message ?? "no data"}`);
  }
  return result.data;
}

/** An auth user with a known throwaway password. */
async function createAuthUser(admin: SupabaseClient, role: string, label: string) {
  const email = `${role}+${randomUUID().slice(0, 8)}@example.test`;
  const password = `prova ${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const authId = must({ data: created.data.user?.id ?? null, error: created.error }, label);
  return { email, password, authId };
}

/** A venue ("Osteria Demo A") with an owner, two admins, a chef and a waiter, all with passwords, in the default mode (enrolled). */
export async function createVenue(env: StackEnv, admin: SupabaseClient) {
  void env;
  const owner = await createAuthUser(admin, "owner", "owner");
  const tenantId = must(
    await admin.rpc("create_tenant_with_owner", {
      tenant_name: "Osteria Demo A",
      tenant_vat_number: fakeVat(),
      owner_auth_id: owner.authId,
      owner_display_name: "Titolare Demo",
    }),
    "tenant",
  ) as string;
  const appUserOf = async (authId: string): Promise<string> => {
    const row = must(
      await admin.from("app_user").select("id").eq("auth_id", authId).single(),
      "app_user id",
    ) as { id: string };
    return row.id;
  };
  const member = async (role: Account["role"], label: string): Promise<Account> => {
    const user = await createAuthUser(admin, role, label);
    const inserted = await admin
      .from("app_user")
      .insert({ tenant_id: tenantId, auth_id: user.authId, role, display_name: label });
    if (inserted.error) throw new Error(`Fixture failed: ${label}: ${inserted.error.message}`);
    return { role, ...user, appUserId: await appUserOf(user.authId) };
  };
  return {
    tenantId,
    owner: { role: "owner", ...owner, appUserId: await appUserOf(owner.authId) } as Account,
    admin: await member("admin", "Admin Demo"),
    adminReserve: await member("admin", "Admin Riserva Demo"),
    chef: await member("chef", "Chef Demo"),
    waiter: await member("waiter", "Cameriere Demo"),
    /** Another admin, added later (after `required`), to see the forced enrolment. */
    addAdmin: () => member("admin", "Admin Nuovo Demo"),
  };
}

/** What reaches Supabase Auth's factor endpoints through a jar client (challenge and verify), counted. */
export function factorCallCounter() {
  const counter = {
    calls: 0,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/auth/v1/factors/")) counter.calls += 1;
      return fetch(input, init);
    }) as typeof fetch,
  };
  return counter;
}

/** A browser: a cookie jar with a password session of the account. */
export async function signInJar(env: StackEnv, account: Account, fetchImpl?: typeof fetch) {
  const jar = new CookieJar();
  const client = createJarClient(env, jar, fetchImpl);
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) throw new Error(`Fixture failed: sign-in: ${error.message}`);
  return { jar, client };
}

export interface TokenClaims {
  aal?: string;
  app_role?: string;
  tenant_id?: string;
  amr: { method: string; timestamp: number }[];
}

/** The decoded access-token claims of the session held in a client's jar. */
export async function claimsOf(client: SupabaseClient): Promise<TokenClaims> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No session in the jar");
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

/** Remembers the last TOTP step used for each factor, so a code is never reused (Supabase refuses it) and the test waits for the next step when it must. */
export class StepBook {
  private readonly last = new Map<string, number>();

  async code(factorId: string, secret: string): Promise<string> {
    const { code, step } = await freshCode(secret, this.last.get(factorId) ?? null);
    this.last.set(factorId, step);
    return code;
  }
}
