import { describe, expect, it } from "vitest";
import { pingAuthHealth } from "../../../scripts/lib/backup/keepalive";

const KEY = "test-publishable-key";

function fake(status: number | Error) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (status instanceof Error) throw status;
    return new Response("{}", { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("pingAuthHealth", () => {
  it("sends one GET to /auth/v1/health with the apikey header", async () => {
    const { fetchFn, calls } = fake(200);
    await expect(pingAuthHealth(fetchFn, "https://abc.supabase.co", KEY)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://abc.supabase.co/auth/v1/health");
    expect(calls[0]!.init?.method).toBe("GET");
    expect((calls[0]!.init?.headers as Record<string, string>).apikey).toBe(KEY);
  });

  it("ignores a path or trailing slash on the project URL", async () => {
    const { fetchFn, calls } = fake(200);
    await pingAuthHealth(fetchFn, "https://abc.supabase.co/rest/v1/", KEY);
    expect(calls[0]!.url).toBe("https://abc.supabase.co/auth/v1/health");
  });

  it("throws keepalive_failed:503 on a 503", async () => {
    const { fetchFn } = fake(503);
    await expect(pingAuthHealth(fetchFn, "https://abc.supabase.co", KEY)).rejects.toThrow(
      "keepalive_failed:503",
    );
  });

  it("throws keepalive_failed:network when the request fails, without the key", async () => {
    const { fetchFn } = fake(new Error(`socket closed ${KEY}`));
    const error = await pingAuthHealth(fetchFn, "https://abc.supabase.co", KEY).catch((e) => e);
    expect((error as Error).message).toBe("keepalive_failed:network");
  });

  it("never puts the key in an error", async () => {
    const { fetchFn } = fake(401);
    const error = await pingAuthHealth(fetchFn, "https://abc.supabase.co", KEY).catch((e) => e);
    expect((error as Error).message).not.toContain(KEY);
  });

  it("refuses a URL that is not https, before any request", async () => {
    const { fetchFn, calls } = fake(200);
    await expect(pingAuthHealth(fetchFn, "http://abc.supabase.co", KEY)).rejects.toThrow(
      "keepalive_failed:url",
    );
    await expect(pingAuthHealth(fetchFn, "nonsense", KEY)).rejects.toThrow("keepalive_failed:url");
    expect(calls).toHaveLength(0);
  });
});
