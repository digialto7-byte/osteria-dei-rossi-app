import { describe, expect, it } from "vitest";
import { CookieJar, countingFetch, deviceCookieFrom } from "./cookie-jar";

describe("CookieJar", () => {
  it("stores, returns and deletes cookies like the server client expects", () => {
    const jar = new CookieJar();
    jar.setAll([
      { name: "a", value: "1", options: {} },
      { name: "b", value: "2", options: {} },
    ]);
    expect(jar.getAll()).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
    jar.setAll([{ name: "a", value: "", options: { maxAge: 0 } }]);
    expect(jar.getAll()).toEqual([{ name: "b", value: "2" }]);
  });

  it("clear() empties it (a new browser)", () => {
    const jar = new CookieJar();
    jar.setAll([{ name: "a", value: "1", options: {} }]);
    jar.clear();
    expect(jar.getAll()).toEqual([]);
  });
});

describe("deviceCookieFrom", () => {
  it("reads the device cookie from a response's Set-Cookie", () => {
    const response = new Response(null, {
      headers: { "set-cookie": `__Host-odr_device=${"A".repeat(43)}; Path=/; HttpOnly` },
    });
    expect(deviceCookieFrom(response)).toBe(`__Host-odr_device=${"A".repeat(43)}`);
  });

  it("is null when the response sets none", () => {
    expect(deviceCookieFrom(new Response(null))).toBeNull();
    expect(
      deviceCookieFrom(new Response(null, { headers: { "set-cookie": "x=1; Path=/" } })),
    ).toBeNull();
  });
});

describe("countingFetch", () => {
  it("counts only Supabase Auth token requests and passes everything through", async () => {
    const seen: string[] = [];
    const inner = async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("{}");
    };
    const counter = countingFetch(inner as typeof fetch);
    await counter.fetch("http://127.0.0.1:54321/auth/v1/token?grant_type=password");
    await counter.fetch("http://127.0.0.1:54321/rest/v1/app_user");
    await counter.fetch(new URL("http://127.0.0.1:54321/auth/v1/token?grant_type=refresh_token"));
    expect(counter.tokenRequests).toBe(2);
    expect(seen).toHaveLength(3);
    counter.reset();
    expect(counter.tokenRequests).toBe(0);
  });
});
