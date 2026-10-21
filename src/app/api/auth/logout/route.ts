import { withApi } from "@/lib/api/with-api";

export const POST = withApi({ authenticated: true }, async ({ supabase }) => {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
  return new Response(null, { status: 204 });
});
