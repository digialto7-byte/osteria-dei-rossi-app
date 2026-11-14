// SP0 spike (§3.5, S3): the Supabase clients of the spike scripts. This is the only module that reads the secret key
// variable. Hosted, SPIKE_SECRET_KEY holds a placeholder that the session's network proxy replaces on the wire, so nothing
// here checks the key's form, length or prefix, or decodes it. It goes out on the `apikey` header only: Supabase says
// secret keys are sent on `apikey` alone, and a key on `Authorization: Bearer` is parsed as a JWT and rejected.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CaseReport } from "./report";

type Env = Record<string, string | undefined>;

export interface SpikeEnv {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
}

/** Names the missing variable, never a value. */
export function readSpikeEnv(env: Env): SpikeEnv {
  const need = (name: string): string => {
    const value = env[name];
    if (value === undefined || value === "") throw new Error(`${name} is not set.`);
    return value;
  };
  return {
    supabaseUrl: need("SPIKE_SUPABASE_URL"),
    publishableKey: need("SPIKE_PUBLISHABLE_KEY"),
    secretKey: need("SPIKE_SECRET_KEY"),
  };
}

/** supabase-js may add `Authorization: Bearer <key>` for a key-only client; this removes exactly that and nothing else. */
export function apikeyOnlyFetch(base: typeof fetch, secret: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (headers.get("authorization") === `Bearer ${secret}`) headers.delete("authorization");
    return base(input, { ...init, headers });
  };
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function createAdminClient(env: SpikeEnv, fetchImpl: typeof fetch = fetch): SupabaseClient {
  return createClient(env.supabaseUrl, env.secretKey, {
    auth: NO_SESSION,
    global: { fetch: apikeyOnlyFetch(fetchImpl, env.secretKey) },
  });
}

/** A client that acts as a user: publishable key on `apikey`, the user's access token (when there is one) as Bearer. */
export function createUserClient(
  env: Pick<SpikeEnv, "supabaseUrl" | "publishableKey">,
  accessToken: string | null,
  fetchImpl: typeof fetch = fetch,
): SupabaseClient {
  return createClient(env.supabaseUrl, env.publishableKey, {
    auth: NO_SESSION,
    global: {
      fetch: fetchImpl,
      headers: accessToken === null ? {} : { Authorization: `Bearer ${accessToken}` },
    },
  });
}

/**
 * Before a hosted run: `GET /auth/v1/admin/users?page=1&per_page=1` with the secret-key client.
 * 200 passes; 401/403 means the proxy did not put the key in; anything else is reported, not guessed at.
 */
export async function preflight(admin: SupabaseClient): Promise<CaseReport> {
  const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error === null) return { id: "preflight", result: "pass", detail: { status: 200 } };
  const status = typeof error.status === "number" && error.status > 0 ? error.status : null;
  if (status === 401 || status === 403) {
    return {
      id: "preflight",
      result: "inconclusive",
      detail: { status, reason: "secret key not injected" },
    };
  }
  return {
    id: "preflight",
    result: "inconclusive",
    detail: {
      status,
      reason: status === null ? "Auth could not be reached" : "unexpected answer from Auth",
    },
  };
}
