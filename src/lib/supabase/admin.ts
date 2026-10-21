import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ConfigError, readPublicEnv } from "@/lib/env";

// The secret key bypasses RLS. eslint.config.mjs only lets scripts/ and the cron routes import
// this module, and this is the only place that reads SUPABASE_SECRET_KEY (plan §3.11.1).
const secretKey = z.preprocess((value) => (value === "" ? undefined : value), z.string());

export function readSupabaseSecretKey(source: Record<string, string | undefined> = process.env) {
  const parsed = secretKey.safeParse(source.SUPABASE_SECRET_KEY);
  if (!parsed.success) throw new ConfigError(["SUPABASE_SECRET_KEY"]);
  return parsed.data;
}

export function createSupabaseAdminClient(
  source: Record<string, string | undefined> = process.env,
): SupabaseClient {
  const env = readPublicEnv(source);
  return createClient(env.supabaseUrl, readSupabaseSecretKey(source), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
