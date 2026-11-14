import { describe, expect, it } from "vitest";

// Costì plan, lead decision VD: guests book the osteria, so the tab title of the booking pages is the venue's name, not "Costì".
describe("booking pages keep the venue's tab title", () => {
  it("the request page", async () => {
    const { metadata } = await import("@/app/(public)/prenota/[slug]/page");
    expect(metadata.title).toBe("Osteria Dei Rossi");
  });

  it("the cancel page, which stays out of search engines", async () => {
    const { metadata } = await import("@/app/(public)/prenota/[slug]/annulla/page");
    expect(metadata.title).toBe("Osteria Dei Rossi");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
