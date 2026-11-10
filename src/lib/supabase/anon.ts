import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";

/**
 * A Supabase client that is always `anon`: the publishable key, no cookies and no session, so a staff cookie on the request can never reach it.
 * It calls the five route-gated public reservation functions (ADR-032). Only `src/server/reservations/public/*` may import it
 * (tests/guards/anon-client-importers.test.ts).
 */
export function createSupabaseAnonClient(
  source: Record<string, string | undefined> = process.env,
): SupabaseClient {
  const env = readPublicEnv(source);
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
