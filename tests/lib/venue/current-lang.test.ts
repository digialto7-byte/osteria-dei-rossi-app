// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyVenueSettings, resetVenueSettings } from "@/lib/venue/current";
import { ME_SETTINGS } from "../../helpers/me-data";

afterEach(() => {
  resetVenueSettings();
  document.documentElement.lang = "";
});

// SP1 step 12 (H13): the root layout renders lang="it" (the first paint); the store follows the tenant's locale once it is applied.
describe("the lang attribute follows the store", () => {
  it("applyVenueSettings({locale: 'en'}) sets document.documentElement.lang to en", () => {
    applyVenueSettings({ ...ME_SETTINGS, locale: "en" });
    expect(document.documentElement.lang).toBe("en");
  });

  it("applying Italian sets it, and a reset puts back the first-paint language", () => {
    applyVenueSettings({ ...ME_SETTINGS, locale: "en" });
    applyVenueSettings({ ...ME_SETTINGS, locale: "it" });
    expect(document.documentElement.lang).toBe("it");
    applyVenueSettings({ ...ME_SETTINGS, locale: "en" });
    resetVenueSettings();
    expect(document.documentElement.lang).toBe("it");
  });
});
