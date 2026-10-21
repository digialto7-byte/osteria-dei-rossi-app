import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// Reads `key = value` from a TOML section without a parser dependency; enough for these checks.
function tomlValue(toml: string, section: string, key: string): string | undefined {
  const start = toml.indexOf(`\n[${section}]\n`);
  if (start === -1) return undefined;
  const rest = toml.slice(start + section.length + 4);
  const body = rest.slice(0, rest.search(/\n\[/) === -1 ? undefined : rest.search(/\n\[/));
  return body.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim();
}

describe("vercel.json", () => {
  it("pins functions to Frankfurt (EU)", () => {
    expect(JSON.parse(read("vercel.json")).regions).toEqual(["fra1"]);
  });
});

describe("supabase/config.toml (local auth)", () => {
  const toml = read("supabase/config.toml");
  const APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

  it("redirects only to the app's own origins (acceptance test 12)", () => {
    const siteUrl = JSON.parse(tomlValue(toml, "auth", "site_url") ?? "null");
    const redirects: string[] = JSON.parse(
      tomlValue(toml, "auth", "additional_redirect_urls") ?? "[]",
    );
    expect(APP_ORIGINS).toContain(new URL(siteUrl).origin);
    expect(redirects.length).toBeGreaterThan(0);
    for (const pattern of redirects) {
      // A trailing ** only allows the callback's query string; nothing may precede it.
      expect(pattern).toMatch(/^[^*]+(\*\*)?$/);
      const url = new URL(pattern.replace(/\*\*$/, ""));
      expect(APP_ORIGINS).toContain(url.origin);
      expect(url.pathname).toBe("/api/auth/callback");
    }
  });

  it("turns off self-signup", () => {
    expect(tomlValue(toml, "auth", "enable_signup")).toBe("false");
    expect(tomlValue(toml, "auth.email", "enable_signup")).toBe("false");
  });

  it("enables the access token hook from the app schema", () => {
    expect(tomlValue(toml, "auth.hook.custom_access_token", "enabled")).toBe("true");
    expect(tomlValue(toml, "auth.hook.custom_access_token", "uri")).toBe(
      '"pg-functions://postgres/app/custom_access_token_hook"',
    );
  });

  it("time-boxes sessions to 30 days", () => {
    expect(tomlValue(toml, "auth.sessions", "timebox")).toBe('"720h"');
  });
});
