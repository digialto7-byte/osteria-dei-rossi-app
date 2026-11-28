import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP3 step 14 (docs/plans/2026-11-27-sp03-platform-layer.md §3.2): the hook gains a console block between the PIN branch and the e-mail branches. Tenant
// sign-in stays byte for byte as it was: the strip and the PIN branch are M11's text, the e-mail branches E1–E4 are SP2's text, and the only other change is
// the console block plus the reset of a stale incoming platform_staff role. pgTAP 003, 085, 340, 431 and 441 §4 pin the claims themselves.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const M11 = "20261025100500_access_token_hook_pin.sql";
const SP2 = "20261207100100_memberships.sql";
const SP3 = "20261208101000_hook_console_mode.sql";

const read = (file: string) => readFileSync(join(MIGRATIONS, file), "utf8");
const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const PIN_END = "return jsonb_set(event, '{claims}', claims);\n  end if;";
const E_START = "-- Email accounts (SP2). E1";

/** The hook's text from `create or replace function app.custom_access_token_hook` to its closing `$$;`. */
function hook(sql: string): string {
  const start = sql.indexOf("create or replace function app.custom_access_token_hook");
  if (start < 0) throw new Error("hook not found");
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error("hook end not found");
  return sql.slice(start, end + 4);
}

/** The strip (`claims jsonb := ...;`) and the PIN branch, whitespace-normalised. */
function stripAndPinBranch(sql: string): string {
  const body = hook(sql);
  const start = body.indexOf("claims jsonb :=");
  const pinStart = body.indexOf("select u.id, u.tenant_id, u.role");
  const pinEnd = body.indexOf(PIN_END, pinStart);
  if (start < 0 || pinStart < 0 || pinEnd < 0) throw new Error("hook shape not found");
  const strip = body.slice(start, body.indexOf(";", start) + 1);
  return `${squash(strip)} | ${squash(body.slice(pinStart, pinEnd + PIN_END.length))}`;
}

/** The e-mail branches E1–E4, from SP2's E1 comment to the end of the function, whitespace-normalised. */
function emailBranches(sql: string): string {
  const body = hook(sql);
  const start = body.indexOf(E_START);
  if (start < 0) throw new Error("e-mail branches not found");
  return squash(body.slice(start));
}

/** What lies between the end of the PIN branch and the e-mail branches. */
function between(sql: string): string {
  const body = hook(sql);
  const pinEnd = body.indexOf(PIN_END) + PIN_END.length;
  return body.slice(pinEnd, body.indexOf(E_START));
}

/** The text before the strip: signature, language, volatility, search_path and the declare list. */
function header(sql: string): string {
  const body = hook(sql);
  return squash(body.slice(0, body.indexOf("claims jsonb :=")));
}

describe("the SP3 hook (step 14)", () => {
  it("keeps M11's claim strip and PIN branch word for word", () => {
    expect(stripAndPinBranch(read(SP3))).toBe(stripAndPinBranch(read(M11)));
  });

  it("keeps SP2's e-mail branches E1–E4 word for word", () => {
    expect(emailBranches(read(SP3))).toBe(emailBranches(read(SP2)));
  });

  it("keeps SP2's signature, volatility, search_path and declare list, and SP2's declarations after the strip", () => {
    expect(header(read(SP3))).toBe(header(read(SP2)));
    const declarations = (sql: string) => {
      const body = hook(sql);
      const afterStrip = body.indexOf(";", body.indexOf("claims jsonb :=")) + 1;
      return squash(body.slice(afterStrip, body.indexOf("\nbegin\n", afterStrip)));
    };
    expect(declarations(read(SP3))).toBe(declarations(read(SP2)));
  });

  it("adds only the console block and the stale-role reset between them (SP2 had nothing there)", () => {
    expect(squash(between(read(SP2)))).toBe("");
    const added = squash(between(read(SP3)).replace(/^\s*--.*$/gm, ""));
    expect(added).toBe(
      squash(`begin
    if exists (select 1
                 from platform.console_session c
                 join platform.staff s on s.auth_id = c.auth_id
                where c.session_id = (event -> 'claims' ->> 'session_id')::uuid
                  and c.auth_id = (event ->> 'user_id')::uuid
                  and s.role = 'platform_admin'
                  and s.is_active) then
      return jsonb_set(event, '{claims}', jsonb_set(claims, '{role}', to_jsonb('platform_staff'::text)));
    end if;
  exception when others then
    null;
  end;
  if claims ->> 'role' = 'platform_staff' then
    claims := jsonb_set(claims, '{role}', to_jsonb('authenticated'::text));
  end if;`),
    );
  });

  it("is the newest definition of the hook, so the tested text is the live one", () => {
    const defining = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        /create\s+or\s+replace\s+function\s+app\.custom_access_token_hook/i.test(read(f)),
      );
    expect(defining.at(-1)).toBe(SP3);
  });

  it("self-test: a changed PIN branch, a changed e-mail branch and an extra statement are each caught", () => {
    const sql = read(SP3);
    expect(stripAndPinBranch(sql.replace("'login', 'pin'", "'login', 'other'"))).not.toBe(
      stripAndPinBranch(read(M11)),
    );
    expect(
      emailBranches(sql.replace("if active_count = 1 then", "if active_count >= 1 then")),
    ).not.toBe(emailBranches(read(SP2)));
    const extra = sql.replace(
      "  -- A stale incoming platform_staff role",
      "  claims := claims || '{\"x\": 1}';\n  -- A stale incoming platform_staff role",
    );
    expect(squash(between(extra).replace(/^\s*--.*$/gm, ""))).not.toBe(
      squash(between(sql).replace(/^\s*--.*$/gm, "")),
    );
  });
});
