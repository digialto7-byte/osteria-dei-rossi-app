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
