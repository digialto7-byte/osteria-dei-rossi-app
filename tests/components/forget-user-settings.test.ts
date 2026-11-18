// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { forgetUser } from "@/components/forget-user";
import { applyVenueSettings, venueSettingsApplied } from "@/lib/venue/current";
import { ME_SETTINGS } from "../helpers/me-data";

describe("forgetUser and the venue settings (SP1 step 9)", () => {
  it("empties the store and the stored copy, so a switch to another tenant never keeps the last one's settings", () => {
    applyVenueSettings(ME_SETTINGS as never);
    expect(venueSettingsApplied()).toBe(true);
    forgetUser(
      undefined,
      () => true,
      () => undefined,
    );
    expect(venueSettingsApplied()).toBe(false);
    expect(window.localStorage.getItem("venue-settings")).toBeNull();
  });
});
