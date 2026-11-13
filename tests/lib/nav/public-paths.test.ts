import { describe, expect, it } from "vitest";
import { isGuestPath } from "@/lib/nav/public-paths";

describe("isGuestPath (pages a guest, not staff, reaches)", () => {
  it.each(["/prenota/osteria-demo", "/prenota/osteria-demo/annulla", "/prenota/x"])(
    "%s is a guest page",
    (path) => {
      expect(isGuestPath(path)).toBe(true);
    },
  );

  it.each([
    "/prenotazioni",
    "/prenotazioni/abc",
    "/prenota",
    "/login",
    "/pin",
    "/dispositivo",
    "/",
    "",
  ])("%j is not", (path) => {
    expect(isGuestPath(path)).toBe(false);
  });

  it("does not match a path that only contains the prefix", () => {
    expect(isGuestPath("/x/prenota/y")).toBe(false);
  });
});
