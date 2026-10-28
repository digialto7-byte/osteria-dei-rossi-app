import { describe, expect, it } from "vitest";
import { canEditMasterData, canReadMasterData } from "@/lib/master/master-access";

// Mirror GET /api/suppliers|ingredients|locations (owner, admin, chef) and their POSTs (owner, admin).
describe("master data access", () => {
  it.each(["owner", "admin", "chef"])("%s can read", (role) => {
    expect(canReadMasterData(role)).toBe(true);
  });
  it.each(["waiter", "", "unknown"])("%j cannot read", (role) => {
    expect(canReadMasterData(role)).toBe(false);
  });
  it.each(["owner", "admin"])("%s can edit", (role) => {
    expect(canEditMasterData(role)).toBe(true);
  });
  it.each(["chef", "waiter", "", "unknown"])("%j cannot edit", (role) => {
    expect(canEditMasterData(role)).toBe(false);
  });
});
