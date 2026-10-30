import { describe, expect, it } from "vitest";

// /tavoli/<id> keeps working (old links, bookmarks, the e2e helpers): it redirects to the static comanda (M20 plan §3.6.4).
const ID = "5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f";
const { default: Page } = await import("@/app/(owner)/tavoli/[sessionId]/page");

async function digestOf(sessionId: string): Promise<string> {
  try {
    await Page({ params: Promise.resolve({ sessionId }) });
  } catch (error) {
    return String((error as { digest?: string }).digest ?? "no digest");
  }
  return "no throw";
}

describe("the old comanda URL", () => {
  it("redirects a session id to /tavoli/comanda?s=<id>", async () => {
    const digest = await digestOf(ID);
    expect(digest).toMatch(/^NEXT_REDIRECT;/);
    expect(digest).toContain(`/tavoli/comanda?s=${ID}`);
  });

  it("is a not-found for anything that is not a uuid (it reveals nothing and redirects nowhere)", async () => {
    for (const bad of ["x", "comandaa", `${ID}/..`, "5b0c9f0e", ""]) {
      expect(await digestOf(bad), bad).toContain("404");
    }
  });
});
