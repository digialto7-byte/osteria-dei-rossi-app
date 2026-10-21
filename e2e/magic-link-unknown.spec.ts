import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { classifyOtpError } from "../src/lib/auth/otp-error";
import { fakeEmail, requireSupabaseStack } from "./helpers/session";

requireSupabaseStack();

// Pins the error code real Supabase Auth returns for an address without an account, so the
// magic-link route keeps answering it quietly instead of logging a warning for every typo.
test("real Supabase Auth's answer for an unknown address is classified as unknown_address", async () => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await supabase.auth.signInWithOtp({
    email: fakeEmail("nobody"),
    options: { shouldCreateUser: false },
  });
  expect(classifyOtpError(error)).toBe("unknown_address");
});
