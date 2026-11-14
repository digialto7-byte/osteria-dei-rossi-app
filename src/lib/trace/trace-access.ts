// Who sees the trace screens (P2-2 plan §3.8): the owner, the admin and the chef. The waiter has no entry. The database enforces the same
// roles (app.require_trace_reader), so hiding a link is not authorisation.

/** Who may open Tracciabilità. */
export function canTrace(role: string | undefined): boolean {
  return role === "owner" || role === "admin" || role === "chef";
}
