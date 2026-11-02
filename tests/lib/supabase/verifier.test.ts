import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { createVerifierClient } = await import("@/lib/supabase/verifier");

beforeEach(() => createClient.mockClear());

describe("createVerifierClient", () => {
  it("uses the publishable key and keeps no session, no refresh and no cookies", () => {
    createVerifierClient({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
    });
    expect(createClient).toHaveBeenCalledWith("http://127.0.0.1:54321", "sb_publishable_fake", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("does not import the admin client or read the secret key", () => {
    const source = readFileSync(
      new URL("../../../src/lib/supabase/verifier.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/supabase\/admin/);
    expect(source).not.toMatch(/SECRET_KEY/);
    expect(source).not.toMatch(/next\/headers/);
  });
});
