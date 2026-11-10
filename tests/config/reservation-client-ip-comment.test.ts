import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The comment on clientIp is the place a future change of hosting is warned (lead read of #69): why the first x-forwarded-for entry is trusted, where that is
// documented, and what to switch to behind another proxy. It must also say what the route does with no address (400, no RPC), not the old "limits still hold".
describe("the comment on clientIp", () => {
  const source = readFileSync("src/server/reservations/public/http.ts", "utf8");
  const comment = source.slice(0, source.indexOf("export function clientIp"));

  it("cites Vercel's request-headers doc and names x-vercel-forwarded-for and the guide", () => {
    expect(comment).toContain("https://vercel.com/docs/headers/request-headers");
    expect(comment).toMatch(/overwrites/);
    expect(comment).toContain("x-vercel-forwarded-for");
    expect(comment).toContain("docs/guides/prenotazioni.md");
    expect(readFileSync("docs/guides/prenotazioni.md", "utf8")).toContain("x-vercel-forwarded-for");
  });

  it("says a missing address is a 400 before any RPC, and no longer that the other limits still hold", () => {
    expect(comment).toMatch(/400 invalid_request before any RPC/);
    expect(comment).not.toMatch(/limits still hold/);
  });
});
