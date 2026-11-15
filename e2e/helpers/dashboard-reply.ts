import { dashboardOutput } from "@/server/dashboard/output";

/**
 * What is wrong with Oggi's GET /api/dashboard reply after a link sign-in, or null when it is the expected role's dashboard. Oggi sends its one
 * POST /api/dashboard/opens only after a good owner read (src/components/use-dashboard.ts, the same schema), so a reply that does not fit or answers
 * another role means that POST never comes: the helper fails here by name instead of at the 30 s test timeout (lead, #132 review NOTE).
 */
export function dashboardReplyProblem(body: unknown, role: "owner" | "admin"): string | null {
  const reply = dashboardOutput.safeParse(body);
  if (!reply.success)
    return "Oggi's GET /api/dashboard reply does not fit the dashboard schema after the link sign-in (Oggi sends no open POST then)";
  if (reply.data.role !== role)
    return `Oggi's GET /api/dashboard answered role ${reply.data.role}, expected ${role}, after the link sign-in`;
  return null;
}
