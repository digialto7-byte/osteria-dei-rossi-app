import type { SupabaseClient } from "@supabase/supabase-js";
import { membershipRows, type Membership } from "@/server/tenancy/output";

/**
 * The caller's own active memberships (public.my_memberships, SP2 S4). An RPC error is reported with its code only (never a message, which could
 * name a tenant); a reply that does not match the strict schema is refused (500), never trimmed.
 */
export async function readMemberships(supabase: SupabaseClient): Promise<Membership[]> {
  const { data, error } = await supabase.rpc("my_memberships");
  if (error) throw new Error(`my_memberships failed: ${error.code ?? "no code"}`);
  const parsed = membershipRows.safeParse(data);
  if (!parsed.success) throw new Error("my_memberships returned an unexpected shape");
  return parsed.data;
}
