import { describe, expect, it } from "vitest";
import {
  canManageStaff,
  staffActions,
  staffBadges,
  type StaffItem,
} from "@/lib/staff-auth/staff-view";

const ITEM: StaffItem = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Cameriere Demo",
  role: "waiter",
  loginMethod: "pin",
  active: true,
  lockedUntil: null,
};

describe("canManageStaff", () => {
  it("owner and admin only", () => {
    expect(canManageStaff("owner")).toBe(true);
    expect(canManageStaff("admin")).toBe(true);
    for (const role of ["chef", "waiter", "x", ""]) expect(canManageStaff(role)).toBe(false);
  });
});

describe("staffBadges", () => {
  it("a normal PIN account has the role word only", () => {
    expect(staffBadges(ITEM).map((b) => b.label)).toEqual(["Cameriere"]);
  });
  it("locked -> 'Bloccato fino alle 21:15' (Europe/Rome), warning", () => {
    const badges = staffBadges({ ...ITEM, lockedUntil: "2026-10-24T19:15:00Z" });
    expect(badges).toContainEqual({ tone: "warning", label: "Bloccato fino alle 21:15" });
  });
  it("inactive -> 'Disattivato' and no lock badge", () => {
    const badges = staffBadges({ ...ITEM, active: false, lockedUntil: "2026-10-24T19:15:00Z" });
    expect(badges.map((b) => b.label)).toEqual(["Cameriere", "Disattivato"]);
  });
  it("email staff -> 'Accesso con email'", () => {
    expect(staffBadges({ ...ITEM, loginMethod: "email" }).map((b) => b.label)).toEqual([
      "Cameriere",
      "Accesso con email",
    ]);
  });
  it("chef word and english second", () => {
    expect(staffBadges({ ...ITEM, role: "chef" })[0]?.label).toBe("Cuoco");
    expect(staffBadges({ ...ITEM, role: "chef" }, "en")[0]?.label).toBe("Chef");
  });
});

describe("staffActions", () => {
  it("a PIN account can change PIN, role and be deactivated", () => {
    expect(staffActions(ITEM)).toEqual({ pin: true, toggle: "deactivate", role: true });
  });
  it("an email account has no PIN action", () => {
    expect(staffActions({ ...ITEM, loginMethod: "email" }).pin).toBe(false);
  });
  it("an inactive account can be reactivated but has no PIN action", () => {
    expect(staffActions({ ...ITEM, active: false })).toEqual({
      pin: false,
      toggle: "reactivate",
      role: true,
    });
  });
});
