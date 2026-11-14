import { describe, expect, it, vi } from "vitest";
import { createStaffUser } from "../../../scripts/lib/sp00/staff";

function fakeAdmin(overrides: { userError?: boolean; memberError?: boolean } = {}) {
  const insert = vi.fn(async (_row: Record<string, unknown>) => ({
    error: overrides.memberError ? { code: "x" } : null,
  }));
  const createUser = vi.fn(async () => ({
    data: { user: overrides.userError ? null : { id: "u-1" } },
    error: overrides.userError ? { message: "no" } : null,
  }));
  const from = vi.fn((_table: string) => ({ insert }));
  return { admin: { auth: { admin: { createUser } }, from }, insert, createUser, from };
}
const ids = {
  newId: () => "a1b2c3d4-0000-4000-8000-123456789012",
  newPassword: () => "P".repeat(43),
};

describe("createStaffUser", () => {
  it.each(["waiter", "chef"] as const)(
    "inserts the app_user row with the requested role %s",
    async (role) => {
      const { admin, insert, from } = fakeAdmin();
      const result = await createStaffUser(admin, "tenant-1", role, ids);
      expect(from).toHaveBeenCalledWith("app_user");
      expect(insert).toHaveBeenCalledWith({
        tenant_id: "tenant-1",
        auth_id: "u-1",
        role,
        display_name: `SP0 ${role}`,
      });
      expect(result.email).toBe(`sp0-${role}-a1b2c3d4@example.test`);
      expect(result.password).toHaveLength(43);
    },
  );

  it("names the role in its errors", async () => {
    await expect(
      createStaffUser(fakeAdmin({ userError: true }).admin, "t", "chef", ids),
    ).rejects.toThrow("creating the chef failed");
    await expect(
      createStaffUser(fakeAdmin({ memberError: true }).admin, "t", "waiter", ids),
    ).rejects.toThrow("adding the waiter failed");
  });
});
