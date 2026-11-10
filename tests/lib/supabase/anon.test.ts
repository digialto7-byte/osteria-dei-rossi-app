import { beforeEach, describe, expect, it, vi } from "vitest";

// ADR-032: the anon client holds the publishable key and nothing else, and it never reads cookies, so its role is `anon` even on a staff phone.
const createClient = vi.fn((..._args: unknown[]) => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));
const cookies = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => cookies(), headers: () => cookies() }));

const { createSupabaseAnonClient } = await import("@/lib/supabase/anon");

const SOURCE = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
  SUPABASE_SECRET_KEY: "sb_secret_fake",
};

beforeEach(() => {
  createClient.mockClear();
  cookies.mockClear();
});

describe("createSupabaseAnonClient", () => {
  it("uses the URL and the publishable key, never the secret key", () => {
    createSupabaseAnonClient(SOURCE);
    const [url, key] = createClient.mock.calls[0] as [string, string];
    expect(url).toBe("http://127.0.0.1:54321");
    expect(key).toBe("sb_publishable_fake");
    expect(JSON.stringify(createClient.mock.calls)).not.toContain("sb_secret_fake");
  });

  it("keeps no session and reads no cookie", () => {
    createSupabaseAnonClient(SOURCE);
    const options = createClient.mock.calls[0]?.[2] as { auth: Record<string, boolean> };
    expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
    expect(cookies).not.toHaveBeenCalled();
  });

  it("names the missing variable when the environment is incomplete", () => {
    expect(() => createSupabaseAnonClient({})).toThrow(/NEXT_PUBLIC_SUPABASE/);
  });
});
