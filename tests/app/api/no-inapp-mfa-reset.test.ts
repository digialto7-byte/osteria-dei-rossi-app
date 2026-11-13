import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P2-1 (founder decision Q-T1 = V1, 2026-11-12): the reset of an authenticator is DigiAlto's script, not the app. No route can reset another account's factors:
// nothing under src/app/api/users/ mentions the second factor, and no route file or folder is named for a reset.
const API = join(process.cwd(), "src/app/api");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

describe("no in-app reset of the second factor", () => {
  it("no file under src/app/api/users mentions mfa, factors or totp", () => {
    for (const file of files(join(API, "users"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/mfa|factor|totp/i);
    }
  });

  it("no route path contains mfa-reset or a reset of factors", () => {
    expect(files(API).filter((f) => /mfa-reset|mfa\/reset|factors\/reset/i.test(f))).toEqual([]);
  });

  it("no API route calls Supabase's admin MFA functions (listFactors or deleteFactor of the admin API)", () => {
    for (const file of files(API)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/auth\.admin\.mfa|deleteFactor/);
    }
  });

  it("the one MFA route that reads other accounts is the read-only list", () => {
    const route = readFileSync(join(API, "mfa/accounts/route.ts"), "utf8");
    expect(route).toMatch(/export const GET\b/);
    expect(route).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/);
  });
});
