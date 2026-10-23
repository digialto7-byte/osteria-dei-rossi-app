import { withApi } from "@/lib/api/with-api";
import { reportError } from "@/lib/observability/report";

export const POST = withApi({ authenticated: true }, async ({ supabase }) => {
  // A PIN session is closed in Postgres first (a no-op for email sessions). A failure must not keep
  // the person signed in, so it is reported by code only and the sign-out still runs.
  try {
    const { error } = await supabase.rpc("end_my_staff_session");
    if (error) reportError(new Error(`end_my_staff_session failed: ${error.code ?? "no code"}`));
  } catch {
    reportError(new Error("end_my_staff_session failed: request"));
  }
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
  return new Response(null, { status: 204 });
});
