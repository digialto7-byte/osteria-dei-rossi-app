import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminDashboardSchema,
  dashboardOutput,
  ownerDashboardSchema,
} from "@/server/dashboard/output";
import { renderDashboard } from "@/server/dashboard/render";
import { adminSql, ownerSql } from "../../fixtures/dashboard-sql";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";

const FORBIDDEN_KEYS = /fixed|rent|labour|utilit|perPlate/i;

function keysOf(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.push(k);
      keysOf(v, into);
    }
  }
  return into;
}

describe("the output schemas", () => {
  it("the owner schema (as JSON Schema) matches its snapshot", () => {
    expect(z.toJSONSchema(ownerDashboardSchema)).toMatchSnapshot();
  });

  it("the admin schema (as JSON Schema) matches its snapshot", () => {
    expect(z.toJSONSchema(adminDashboardSchema)).toMatchSnapshot();
  });

  it("no property of the admin schema is about fixed costs", () => {
    const props = keysOf(z.toJSONSchema(adminDashboardSchema).properties);
    // Only property names count, not the descriptions of enum values; the schema has none that match.
    expect(props.filter((p) => FORBIDDEN_KEYS.test(p))).toEqual([]);
  });

  it("the owner schema does carry fixedCosts, and the rendered fixtures validate", () => {
    const owner = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
    const admin = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");
    expect(ownerDashboardSchema.safeParse(owner).success).toBe(true);
    expect(adminDashboardSchema.safeParse(admin).success).toBe(true);
    expect(dashboardOutput.safeParse(owner).success).toBe(true);
    expect(dashboardOutput.safeParse(admin).success).toBe(true);
    expect("fixedCosts" in owner.tiles).toBe(true);
    expect(keysOf(admin).filter((k) => FORBIDDEN_KEYS.test(k))).toEqual([]);
  });

  it("an extra key on the admin output is refused", () => {
    const admin = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");
    const withFixed = { ...admin, tiles: { ...admin.tiles, fixedCosts: {} } };
    expect(dashboardOutput.safeParse(withFixed).success).toBe(false);
  });
});
