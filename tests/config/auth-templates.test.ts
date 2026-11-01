import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

// M25a step 9 (plan §5): Italian Auth e-mails that carry a link and a 6-digit code, and the Auth settings
// the password sign-in relies on (local stack; the hosted values are set in the dashboard, plan §8 M-1).
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** Reads `key = value` from a TOML section without a parser dependency. */
function tomlValue(toml: string, section: string, key: string): string | undefined {
  const start = toml.indexOf(`\n[${section}]\n`);
  if (start === -1) return undefined;
  const rest = toml.slice(start + section.length + 4);
  const end = rest.search(/\n\[/);
  const body = end === -1 ? rest : rest.slice(0, end);
  return body.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim();
}

const toml = read("supabase/config.toml");

describe("supabase/config.toml (M25a auth settings)", () => {
  it("minimum password length equals the app's", () => {
    expect(tomlValue(toml, "auth", "minimum_password_length")).toBe(String(PASSWORD_MIN_LENGTH));
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });

  it("has no composition rules and keeps secure_password_change off", () => {
    expect(tomlValue(toml, "auth", "password_requirements")).toBe('""');
    expect(tomlValue(toml, "auth.email", "secure_password_change")).toBe("false");
  });

  it("keeps the 30-day time-box and the sign-in and verification limits", () => {
    expect(tomlValue(toml, "auth.sessions", "timebox")).toBe('"720h"');
    expect(tomlValue(toml, "auth.rate_limit", "sign_in_sign_ups")).toBe("30");
    expect(tomlValue(toml, "auth.rate_limit", "token_verifications")).toBe("30");
  });

  it("keeps a 6-digit e-mail code", () => {
    expect(tomlValue(toml, "auth.email", "otp_length")).toBe("6");
  });

  it("customises the magic-link e-mail in Italian, with an existing file", () => {
    expect(tomlValue(toml, "auth.email.template.magic_link", "subject")).toBe(
      '"Il tuo accesso a Osteria Dei Rossi"',
    );
    for (const section of ["magic_link"]) {
      const path = tomlValue(toml, `auth.email.template.${section}`, "content_path");
      expect(path, section).toBeDefined();
      const file = JSON.parse(path!) as string;
      expect(existsSync(new URL(`../../${file.replace(/^\.\//, "")}`, import.meta.url)), file).toBe(
        true,
      );
    }
  });

  it("has no recovery template: nothing calls resetPasswordForEmail (ADR-029)", () => {
    expect(toml).not.toMatch(/^\[auth\.email\.template\.recovery\]/m);
    expect(existsSync(new URL("../../supabase/templates/recovery.html", import.meta.url))).toBe(
      false,
    );
  });

  it("leaves the password-changed notification commented out (plan Q205)", () => {
    expect(toml).not.toMatch(/^\[auth\.email\.notification\.password_changed\]/m);
  });
});

describe.each(["supabase/templates/magic-link.html"])("%s", (path) => {
  const html = read(path);

  it("prints the link as a button and as plain text, and the code", () => {
    expect(html).toMatch(/href="\{\{ \.ConfirmationURL \}\}"/);
    const visible = html.replace(/<[^>]*>/g, " ");
    expect(visible).toContain("{{ .ConfirmationURL }}");
    expect(visible).toContain("{{ .Token }}");
  });

  it("uses only the two template variables", () => {
    const used = [...html.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
    expect(new Set(used)).toEqual(new Set([".ConfirmationURL", ".Token"]));
  });

  it("is Italian: tap the button or type the code, ignore it if you did not ask", () => {
    expect(html).toMatch(/lang="it"/);
    expect(html).toMatch(/codice/i);
    expect(html).toMatch(/non hai richiesto|se non sei stato tu|ignora/i);
  });

  it("names the venue and states no other client fact", () => {
    expect(html).toContain("Osteria Dei Rossi");
    expect(html).not.toContain("@");
    expect(html).not.toMatch(/\d{6,}/);
    expect(html).not.toMatch(/\+?\d[\d\s]{7,}\d/);
    expect(html).not.toMatch(/http/i);
    expect(html).not.toMatch(/digialto/i);
  });

  it("has no script, no event handler and no external image", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/url\(/i);
  });
});
