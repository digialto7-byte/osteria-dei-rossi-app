import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { reportError } from "@/lib/observability/report";
import { platformError, type PlatformDb } from "@/server/platform/rpc";

// SP3 step 17 (plan §3.4.4, §3.6 step 4): the switch into console mode and the way out. select_console decides (the active platform admin with a verified
// factor at aal2); the refreshed token must then carry role = platform_staff (the hook's console branch), or the switch failed.

const CONSOLE_ROLE = "platform_staff";
const switchFailed = () =>
  new ApiError(503, "console_switch_failed", "La console non è disponibile ora. Riprova tra poco.");

/** POST /api/platform/console: select_console, then one refresh on the same client, then the new claims must be console mode. */
export async function enterConsole(supabase: PlatformDb): Promise<{ mode: "console" }> {
  const { error } = await supabase.rpc("select_console");
  if (error) {
    // A token without a session id cannot be put in console mode: the person signs in again.
    if (error.code === "P0001" && error.message === "session_missing") {
      throw new ApiError(401, "unauthenticated", "Accesso richiesto.");
    }
    throw platformError("select_console", error);
  }
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) {
    reportError(new Error(`console refresh failed: code=${refreshed.error.code ?? "none"}`));
    throw switchFailed();
  }
  const { data } = await supabase.auth.getClaims();
  const claims = z.object({ role: z.string() }).safeParse(data?.claims);
  if (!claims.success || claims.data.role !== CONSOLE_ROLE) throw switchFailed();
  return { mode: "console" };
}

/** POST /api/platform/logout: leave console mode (best effort, by code only on failure), then sign out of this browser. */
export async function leaveAndSignOut(supabase: PlatformDb, consoleMode: boolean): Promise<void> {
  if (consoleMode) {
    try {
      const { error } = await supabase.rpc("platform_leave_console");
      if (error)
        reportError(new Error(`platform_leave_console failed: ${error.code ?? "no code"}`));
    } catch {
      reportError(new Error("platform_leave_console failed: request"));
    }
  }
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
}
