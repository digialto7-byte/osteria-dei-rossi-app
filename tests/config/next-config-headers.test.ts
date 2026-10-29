import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { describe, expect, it } from "vitest";
import config from "../../next.config";

// M20 plan §3.6.3: /sw.js is served raw, never cached by the browser, as JavaScript; every path keeps the M0 security headers.
async function rules() {
  const resolved = config(PHASE_DEVELOPMENT_SERVER);
  return (await resolved.headers!()) as {
    source: string;
    headers: { key: string; value: string }[];
  }[];
}
const value = (headers: { key: string; value: string }[], key: string) =>
  headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

describe("next.config headers", () => {
  it("/sw.js gets Cache-Control: no-cache, max-age=0 and a JavaScript content type", async () => {
    const rule = (await rules()).find((r) => r.source === "/sw.js");
    expect(rule).toBeDefined();
    expect(value(rule!.headers, "Cache-Control")).toBe("no-cache, max-age=0");
    expect(value(rule!.headers, "Content-Type")).toBe("text/javascript; charset=utf-8");
  });

  it("every path keeps the M0 security headers", async () => {
    const all = (await rules()).find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    expect(value(all!.headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(all!.headers, "X-Frame-Options")).toBe("DENY");
    expect(value(all!.headers, "Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("no other path gets a cache-control header", async () => {
    const others = (await rules()).filter((r) => r.source !== "/sw.js");
    expect(
      others.flatMap((r) => r.headers).filter((h) => h.key.toLowerCase() === "cache-control"),
    ).toEqual([]);
  });
});
