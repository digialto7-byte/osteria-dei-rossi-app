import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStaffAuthDbError, mapStaffAuthStatus, StaffAuthCallError } from "./errors";

/** Calls an owner/admin procedure in the caller's own session (RLS and the role check apply). */
export async function callAsUser<T>(
  supabase: SupabaseClient,
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (args === undefined
    ? supabase.rpc(name)
    : supabase.rpc(name, args));
  if (error) throw mapStaffAuthDbError(error);
  return data as T;
}

/** Runs a privileged Auth admin call; an upstream failure is a 502, a programming error stays a 500. */
export async function viaAuthAdmin<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof StaffAuthCallError && error.code !== "invalid_argument") {
      throw mapStaffAuthStatus("upstream_error");
    }
    throw error;
  }
}
