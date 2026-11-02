import { describe, expect, it } from "vitest";
import { countActiveDevices, countActiveStaff, setupGuide } from "@/lib/staff-auth/setup-guide";

describe("setupGuide", () => {
  it("for a new venue shows four steps, steps 1 and 3 still to do, expanded, no warning", () => {
    const guide = setupGuide({ staffCount: 0, deviceCount: 0, pinLoginReady: true });
    expect(guide.warning).toBeNull();
    expect(guide.collapsed).toBe(false);
    expect(guide.steps.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(guide.steps.map((s) => s.state)).toEqual(["todo", null, "todo", null]);
  });

  it("marks steps 1 and 3 done and collapses once both are", () => {
    const guide = setupGuide({ staffCount: 2, deviceCount: 1, pinLoginReady: true });
    expect(guide.steps.map((s) => s.state)).toEqual(["done", null, "done", null]);
    expect(guide.collapsed).toBe(true);
  });

  it("stays expanded while only one of the two is done", () => {
    expect(setupGuide({ staffCount: 1, deviceCount: 0, pinLoginReady: true }).collapsed).toBe(
      false,
    );
    expect(setupGuide({ staffCount: 0, deviceCount: 3, pinLoginReady: true }).collapsed).toBe(
      false,
    );
  });

  it("puts a warning first when PIN login is not ready on the server", () => {
    const guide = setupGuide({ staffCount: 0, deviceCount: 0, pinLoginReady: false });
    expect(guide.warning).toBe("pin_not_ready");
  });

  it("keeps the warning even when the guide would be collapsed", () => {
    const guide = setupGuide({ staffCount: 1, deviceCount: 1, pinLoginReady: false });
    expect(guide.warning).toBe("pin_not_ready");
    expect(guide.collapsed).toBe(false);
  });

  it("gives every step a title and a body key", () => {
    for (const step of setupGuide({ staffCount: 0, deviceCount: 0, pinLoginReady: true }).steps) {
      expect(step.titleKey).toBe(`guide.step${step.number}.title`);
      expect(step.bodyKey).toBe(`guide.step${step.number}.body`);
    }
  });
});

describe("counting", () => {
  it("counts active people", () => {
    expect(countActiveStaff([{ active: true }, { active: false }, { active: true }])).toBe(2);
    expect(countActiveStaff([])).toBe(0);
  });
  it("counts devices that are not revoked", () => {
    expect(
      countActiveDevices([{ status: "attivo" }, { status: "bloccato" }, { status: "revocato" }]),
    ).toBe(2);
    expect(countActiveDevices([])).toBe(0);
  });
});
