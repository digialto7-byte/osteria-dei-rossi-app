import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { readPublicEnv } from "@/lib/env";
import { sessionCookieOptionsFromHeaders } from "./cookies";

/**
 * Supabase client acting as the signed-in user (publishable key + session cookies), so every
 * query runs under RLS. For route handlers, where cookies can be written.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const env = readPublicEnv();
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: sessionCookieOptionsFromHeaders(requestHeaders),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
