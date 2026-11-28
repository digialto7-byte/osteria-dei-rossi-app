import { withApi } from "@/lib/api/with-api";
import { logoutResponseSchema } from "@/lib/platform/api";
import { leaveAndSignOut } from "@/server/platform/console";
import { emptyBody } from "@/server/platform/output";

// SP3 step 17 (plan §3.4.4): "Esci" on the console. The one venue-side route a console-mode token may call: it leaves console mode (best effort), then signs out.
export const POST = withApi(
  { authenticated: true, consoleSession: "allow", body: emptyBody },
  async ({ supabase, session }) => {
    await leaveAndSignOut(supabase, session.consoleMode);
    return Response.json(logoutResponseSchema.parse({ ok: true }));
  },
);
