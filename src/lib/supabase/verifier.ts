import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";

/**
 * A throwaway Supabase client for one job: checking a current password (M25a, ADR-029 decision 3). Publishable
 * key only; it keeps no session, never refreshes and touches no cookies, so a check cannot change who is signed
 * in on this device. The caller ends the session it creates with `signOut({ scope: "local" })`.
 */
export function createVerifierClient(
  source: Record<string, string | undefined> = process.env,
): SupabaseClient {
  const env = readPublicEnv(source);
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
