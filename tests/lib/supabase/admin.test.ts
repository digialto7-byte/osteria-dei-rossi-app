import { describe, expect, it } from "vitest";
import { ConfigError } from "@/lib/env";
import { createSupabaseAdminClient, readSupabaseSecretKey } from "@/lib/supabase/admin";

const PUBLIC = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
};

describe("Supabase admin client", () => {
  it("requires SUPABASE_SECRET_KEY and names it", () => {
    expect(() => readSupabaseSecretKey({})).toThrow(ConfigError);
    expect(() => readSupabaseSecretKey({ SUPABASE_SECRET_KEY: "" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => createSupabaseAdminClient(PUBLIC)).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("builds a client when the key is present", () => {
    const client = createSupabaseAdminClient({ ...PUBLIC, SUPABASE_SECRET_KEY: "sb_secret_fake" });
    expect(typeof client.from).toBe("function");
  });
});
