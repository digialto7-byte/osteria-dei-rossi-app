import { randomInt, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Helpers for the real-stack suite (tests/integration/**/*.int.ts). Fixtures (tenants, users,
// reads that must bypass RLS) use the LOCAL stack's secret key, which CI exports from
// `supabase status`; this is test code only. Every assertion about what a user may do runs on a
// client signed in as that user through the publishable key, so Postgres sees a real user JWT.

export interface StackEnv {
  url: string;
  publishableKey: string;
  secretKey: string;
}

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

/**
 * The local stack settings, or null when they are missing on a developer machine (the suite then
 * skips). In CI a missing setting is a configuration error, never a reason to skip: a skipped
 * suite would look green.
 */
export function readStackEnv(source: Record<string, string | undefined> = process.env) {
  const missing = REQUIRED.filter((name) => !source[name]);
  if (missing.length > 0) {
    if (source.CI) throw new Error(`${missing.join(", ")} must be set in CI`);
    return null;
  }
  return {
    url: source.NEXT_PUBLIC_SUPABASE_URL!,
    publishableKey: source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    secretKey: source.SUPABASE_SECRET_KEY!,
  } satisfies StackEnv;
}

const NO_SESSION_STORAGE = { auth: { persistSession: false, autoRefreshToken: false } };

export type UserRole = "owner" | "chef" | "waiter";

export interface TestUser {
  role: UserRole;
  authId: string;
  email: string;
  /** Signed in with a password: requests carry this user's JWT, so RLS applies. */
  client: SupabaseClient;
}

export interface TestTenant {
  id: string;
  owner: TestUser;
  chef: TestUser;
  waiter: TestUser;
}

export interface Stack {
  env: StackEnv;
  /** Secret-key client for fixtures and for reading what RLS hides. Never for the code under test. */
  admin: SupabaseClient;
  tenantA: TestTenant;
  tenantB: TestTenant;
}

const fakeVat = () => `IT${String(randomInt(0, 1e11)).padStart(11, "0")}`;
// The local part is the role only: Auth rejects spaces and other characters a label may hold.
const fakeEmail = (role: UserRole) => `${role}+${randomUUID().slice(0, 8)}@example.test`;

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) {
    throw new Error(`Fixture failed: ${what}: ${result.error?.message ?? "no data"}`);
  }
  return result.data;
}

async function createUser(
  env: StackEnv,
  admin: SupabaseClient,
  tenantId: string,
  role: UserRole,
  label: string,
): Promise<TestUser> {
  const email = fakeEmail(role);
  const password = randomUUID(); // a fresh throwaway per run, never stored anywhere
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const authId = must({ data: created.data.user?.id ?? null, error: created.error }, label);

  const member = await admin
    .from("app_user")
    .insert({ tenant_id: tenantId, auth_id: authId, role, display_name: `Demo ${label}` });
  if (member.error) throw new Error(`Fixture failed: ${label} membership: ${member.error.message}`);
  return { role, authId, email, client: await signIn(env, email, password) };
}

async function signIn(env: StackEnv, email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(env.url, env.publishableKey, NO_SESSION_STORAGE);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Fixture failed: sign-in: ${error?.message}`);
  // The custom access token hook adds the tenant claim; without it every RLS check would be a
  // false negative, so fail loudly here instead.
  const claims = JSON.parse(
    Buffer.from(data.session.access_token.split(".")[1]!, "base64url").toString("utf8"),
  ) as { tenant_id?: string };
  if (!claims.tenant_id) throw new Error("Fixture failed: the access token has no tenant_id");
  return client;
}

async function createTenant(env: StackEnv, admin: SupabaseClient, name: string) {
  // The owner's membership is created together with the tenant by the production procedure.
  const ownerEmail = fakeEmail("owner");
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
  });
  const ownerAuthId = must({ data: created.data.user?.id ?? null, error: created.error }, "owner");
  const tenantId = must(
    await admin.rpc("create_tenant_with_owner", {
      tenant_name: name,
      tenant_vat_number: fakeVat(),
      owner_auth_id: ownerAuthId,
      owner_display_name: `Titolare ${name}`,
    }),
    `tenant ${name}`,
  ) as string;
  const owner: TestUser = {
    role: "owner",
    authId: ownerAuthId,
    email: ownerEmail,
    client: await signIn(env, ownerEmail, password),
  };
  return {
    id: tenantId,
    owner,
    chef: await createUser(env, admin, tenantId, "chef", `chef ${name}`),
    waiter: await createUser(env, admin, tenantId, "waiter", `waiter ${name}`),
  } satisfies TestTenant;
}

/** Two fake tenants ("Osteria Demo A" and "B"), each with an owner, a chef and a waiter. */
export async function createStack(env: StackEnv): Promise<Stack> {
  const admin = createClient(env.url, env.secretKey, NO_SESSION_STORAGE);
  return {
    env,
    admin,
    tenantA: await createTenant(env, admin, "Osteria Demo A"),
    tenantB: await createTenant(env, admin, "Osteria Demo B"),
  };
}
