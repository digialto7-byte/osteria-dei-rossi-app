import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toml = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");

// Reads `key = value` from a [section] without a parser dependency; enough for these checks.
function section(name: string): string | undefined {
  const start = toml.indexOf(`\n[${name}]\n`);
  if (start === -1) return undefined;
  const rest = toml.slice(start + name.length + 4);
  const end = rest.search(/\n\[/);
  return end === -1 ? rest : rest.slice(0, end);
}
const value = (name: string, key: string) =>
  section(name)
    ?.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"))?.[1]
    ?.trim();

// M11: PIN accounts are Supabase auth users with a synthetic, never-mailed address (ADR-010).
describe("supabase/config.toml (staff PIN login)", () => {
  it("keeps self-signup off, so only our flow creates auth users", () => {
    expect(value("auth", "enable_signup")).toBe("false");
  });

  it("enables no auth email notification, so a PIN reset never mails a synthetic address", () => {
    const enabled = [...toml.matchAll(/^\[auth\.email\.notification\.[a-z_]+\]\s*\n([^[]*)/gm)]
      .filter((match) => /^enabled\s*=\s*true/m.test(match[1] ?? ""))
      .map((match) => match[0].split("\n")[0]);
    expect(enabled).toEqual([]);
  });

  it("has the access token hook enabled, pointing at app.custom_access_token_hook", () => {
    expect(value("auth.hook.custom_access_token", "enabled")).toBe("true");
    expect(value("auth.hook.custom_access_token", "uri")).toBe(
      '"pg-functions://postgres/app/custom_access_token_hook"',
    );
  });
});

// P2-1 A8 (docs/plans/2026-11-12-p2-1-totp.md section 3.12): TOTP is on in the LOCAL stack (so the integration tests and the end-to-end tests can enrol); phone MFA stays off.
// Staging and production are the founder's steps M-1 and M-4: nothing here touches a hosted project.
describe("supabase/config.toml (TOTP second factor, local only)", () => {
  it("turns TOTP enrolment and verification on", () => {
    expect(value("auth.mfa.totp", "enroll_enabled")).toBe("true");
    expect(value("auth.mfa.totp", "verify_enabled")).toBe("true");
  });

  it("keeps phone MFA off (an SMS provider and phone numbers are out of scope)", () => {
    expect(value("auth.mfa.phone", "enroll_enabled")).toBe("false");
    expect(value("auth.mfa.phone", "verify_enabled")).toBe("false");
  });

  it("keeps WebAuthn commented out (passkeys are out of P2-1, Q-T8)", () => {
    expect(section("auth.mfa.web_authn")).toBeUndefined();
  });

  it("keeps the factor cap at 10 (our own limit is two per account, enforced in Postgres)", () => {
    expect(value("auth.mfa", "max_enrolled_factors")).toBe("10");
  });

  it("no longer says that MFA needs the Pro plan, and links the TOTP guide", () => {
    // The comment right above [auth.mfa] (other sections, such as storage, still say Pro plan about their own features).
    const above = toml.slice(
      Math.max(0, toml.indexOf("\n[auth.mfa]\n") - 200),
      toml.indexOf("\n[auth.mfa]\n"),
    );
    expect(above).not.toMatch(/Pro plan/i);
    expect(toml).toContain("https://supabase.com/docs/guides/auth/auth-mfa/totp");
    expect(toml).toMatch(/TOTP is free and on for all projects/);
  });
});
