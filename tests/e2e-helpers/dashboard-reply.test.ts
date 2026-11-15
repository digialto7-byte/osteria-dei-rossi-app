import { describe, expect, it } from "vitest";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { dashboardReplyProblem } from "../../e2e/helpers/dashboard-reply";
import { adminSql, ownerSql } from "../fixtures/dashboard-sql";

// The link sign-in helper ends on Oggi's own GET /api/dashboard, then (owner only) the one POST /api/dashboard/opens Oggi sends after a GOOD read
// (src/components/use-dashboard.ts). A reply that fails the schema, or answers the wrong role, means that POST never comes: the helper names it
// instead of waiting 30 s for a POST that cannot arrive (lead, #132 review NOTE).
const owner = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
const admin = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");

describe("dashboardReplyProblem", () => {
  it("a reply of the expected role that fits the dashboard schema has no problem", () => {
    expect(dashboardReplyProblem(owner, "owner")).toBeNull();
    expect(dashboardReplyProblem(admin, "admin")).toBeNull();
  });

  it("a reply of the other role is named, with both roles", () => {
    expect(dashboardReplyProblem(admin, "owner")).toBe(
      "Oggi's GET /api/dashboard answered role admin, expected owner, after the link sign-in",
    );
    expect(dashboardReplyProblem(owner, "admin")).toBe(
      "Oggi's GET /api/dashboard answered role owner, expected admin, after the link sign-in",
    );
  });

  it("a reply that does not fit the dashboard schema is named, so the owner's POST is not awaited in vain", () => {
    const broken = { ...owner, tiles: undefined };
    expect(dashboardReplyProblem(broken, "owner")).toBe(
      "Oggi's GET /api/dashboard reply does not fit the dashboard schema after the link sign-in (Oggi sends no open POST then)",
    );
    expect(dashboardReplyProblem("not json object", "admin")).toBe(
      "Oggi's GET /api/dashboard reply does not fit the dashboard schema after the link sign-in (Oggi sends no open POST then)",
    );
  });
});
