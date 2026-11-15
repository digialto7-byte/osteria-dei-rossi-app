import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP2 S2 (docs/plans/2026-11-14-sp2-memberships.md Q-S8): the SP0 scratch file 03 swaps app_user's unique key from (auth_id) to (tenant_id, auth_id).
// Once SP2's migration has made that swap for real, 03 must still apply, so the sp0-spike workflow keeps running on SP2's schema. It swaps only when
// the auth_id-only unique exists, leaves the table alone when the (tenant_id, auth_id) unique is already there, and still fails loudly when neither is.
const SQL = readFileSync(join(process.cwd(), "scripts/spike/sp00/sql/03_memberships.sql"), "utf8");

/** The SQL without its `--` comments. */
const code = SQL.split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

/** The first `do $$ … end $$;` block (the key swap), without its delimiters. */
function swapBlock(sql: string): string {
  const match = /\bdo\s+\$\$([\s\S]*?)\$\$\s*;/i.exec(sql);
  if (!match) throw new Error("no do block found");
  return match[1]!;
}

describe("SP0 scratch 03 on SP2's membership key", () => {
  const block = swapBlock(code);

  it("self-test: the block extractor finds the do block and not the rest of the file", () => {
    expect(block).toMatch(/begin/i);
    expect(block).not.toMatch(/create\s+table/i);
  });

  it("adds its own composite unique only inside the guarded block, never unconditionally", () => {
    expect(code.replace(block, "")).not.toMatch(/add\s+constraint\s+sp0_app_user_tenant_auth_key/i);
    expect(block).toMatch(
      /add\s+constraint\s+sp0_app_user_tenant_auth_key\s+unique\s*\(tenant_id,\s*auth_id\)/i,
    );
  });

  it("swaps the key only when the auth_id-only unique exists", () => {
    const swap =
      /if\s+v_name\s+is\s+not\s+null\s+then([\s\S]*?)(?:elsif|else)/i.exec(block)?.[1] ?? "";
    expect(swap).toMatch(/drop\s+constraint/i);
    expect(swap).toMatch(/add\s+constraint\s+sp0_app_user_tenant_auth_key/i);
  });

  it("leaves the table alone when a unique on (tenant_id, auth_id) already exists", () => {
    const skip = /elsif\s+v_composite[\s\S]*?then([\s\S]*?)else/i.exec(block)?.[1] ?? "";
    expect(skip).toMatch(/raise\s+notice/i);
    expect(skip).not.toMatch(/alter\s+table|drop\s+constraint|add\s+constraint|raise\s+exception/i);
  });

  it("looks for the composite unique as exactly (tenant_id, auth_id), in that order", () => {
    expect(block).toMatch(/array\['tenant_id',\s*'auth_id'\]/);
  });

  it("still raises when neither unique exists, so a table in an unknown shape is never hidden", () => {
    const fallback = /\belse\b([\s\S]*?)end\s+if/i.exec(block)?.[1] ?? "";
    expect(fallback).toMatch(/raise\s+exception/i);
  });

  it("has no exception handler that swallows an error", () => {
    expect(block).not.toMatch(/\bexception\s+when\b/i);
  });
});
