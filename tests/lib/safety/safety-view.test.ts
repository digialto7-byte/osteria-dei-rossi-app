import { describe, expect, it } from "vitest";
import { canSeeSafety } from "@/lib/safety/safety-view";

// M25b plan step 1: the placeholder page /sicurezza is for the owner and the admin only (Q216). No data sits behind it.
describe("canSeeSafety", () => {
  it("is true for the owner and the admin", () => {
    expect(canSeeSafety("owner")).toBe(true);
    expect(canSeeSafety("admin")).toBe(true);
  });

  it("is false for the chef, the waiter and an unknown role", () => {
    expect(canSeeSafety("chef")).toBe(false);
    expect(canSeeSafety("waiter")).toBe(false);
    expect(canSeeSafety("guest")).toBe(false);
    expect(canSeeSafety("")).toBe(false);
  });
});
