import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP2 S3 (docs/plans/2026-11-26-sp02-memberships.md §3.2): the new hook keeps the incoming-claim strip and the whole PIN branch of M11 word for
// word, so PIN logins (ADR-010) get exactly the claims they got before. Only the e-mail branch changes.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const M11 = "20261025100500_access_token_hook_pin.sql";
const SP2 = "20261207100100_memberships.sql";

const read = (file: string) => readFileSync(join(MIGRATIONS, file), "utf8");
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The hook body from `claims jsonb :=` to the end of the PIN branch (`return jsonb_set(event, '{claims}', claims); end if;`). */
function stripAndPinBranch(sql: string): string {
  const body = sql.slice(sql.indexOf("create or replace function app.custom_access_token_hook"));
  const start = body.indexOf("claims jsonb :=");
  const pinStart = body.indexOf("select u.id, u.tenant_id, u.role");
  const pinEndMarker = "return jsonb_set(event, '{claims}', claims);\n  end if;";
  const pinEnd = body.indexOf(pinEndMarker, pinStart);
  if (start < 0 || pinStart < 0 || pinEnd < 0) throw new Error("hook shape not found");
  const strip = body.slice(start, body.indexOf(";", start) + 1);
  return `${squash(strip)} | ${squash(body.slice(pinStart, pinEnd + pinEndMarker.length))}`;
}

describe("the SP2 hook", () => {
  it("keeps M11's claim strip and PIN branch word for word", () => {
    expect(stripAndPinBranch(read(SP2))).toBe(stripAndPinBranch(read(M11)));
  });

  it("self-test: a changed PIN branch is caught", () => {
    const changed = read(M11).replace("'login', 'pin'", "'login', 'other'");
    expect(stripAndPinBranch(changed)).not.toBe(stripAndPinBranch(read(M11)));
  });
});
