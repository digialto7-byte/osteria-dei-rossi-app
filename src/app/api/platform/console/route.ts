import { withApi } from "@/lib/api/with-api";
import { consoleResponseSchema } from "@/lib/platform/api";
import { enterConsole } from "@/server/platform/console";
import { emptyBody } from "@/server/platform/output";

// SP3 step 17 (plan §3.4.4, §3.6 step 4): the switch into console mode. A session already in console mode answers at once; otherwise select_console decides,
// and the refreshed token must carry role = platform_staff (else 503 console_switch_failed).
export const POST = withApi(
  { authenticated: true, consoleSession: "allow", body: emptyBody },
  async ({ supabase, session }) =>
    Response.json(
      consoleResponseSchema.parse(
        session.consoleMode ? { mode: "console" } : await enterConsole(supabase),
      ),
    ),
);
