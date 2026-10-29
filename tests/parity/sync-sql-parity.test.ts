// Keeps the TypeScript of the offline queue (src/server/sync) in step with the SQL of the migrations 20261109100000_applied_op.sql and
// 20261109100100_apply_op.sql, and with the M19 limit it reuses. M21 adds the kind close_table in the SQL list, the dispatcher and
// SYNC_KINDS together; this test makes the lists change together.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_FIRE_LINES } from "@/server/orders/constants";
import { SYNC_CONFLICT_CODES, SYNC_KINDS } from "@/server/sync/constants";
import { PAYLOADS } from "@/server/sync/schemas";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const applied = read("20261109100000_applied_op.sql");
const apply = read("20261109100100_apply_op.sql");
const found = (name: string, text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};
const quoted = (list: string) => [...list.matchAll(/'(\w+)'/g)].map((x) => x[1]);

describe("the sync lists match the migrations", () => {
  it("SYNC_KINDS are app.sync_op_kinds(), in order", () => {
    const m = found(
      "kinds",
      applied,
      /sync_op_kinds\(\) returns text\[\][\s\S]*?select array\[([^\]]*)\]/,
    );
    expect(quoted(m[1]!)).toEqual([...SYNC_KINDS]);
  });

  it("SYNC_CONFLICT_CODES are app.sync_conflict_codes(), in order", () => {
    const m = found(
      "codes",
      apply,
      /sync_conflict_codes\(\) returns text\[\][\s\S]*?select array\[([^\]]*)\]/,
    );
    expect(quoted(m[1]!)).toEqual([...SYNC_CONFLICT_CODES]);
  });

  it("every kind has a payload schema and a branch in the dispatcher", () => {
    for (const kind of SYNC_KINDS) {
      expect(PAYLOADS[kind], kind).toBeDefined();
      expect(apply, kind).toContain(`when '${kind}' then`);
    }
    expect(Object.keys(PAYLOADS).sort()).toEqual([...SYNC_KINDS].sort());
  });

  it("MAX_FIRE_LINES is still the array bound of fire_course", () => {
    const fire = read("20261106100200_fire_course.sql");
    const m = found("bound", fire, /jsonb_array_length\(v_arr\) not between 1 and (\d+)/);
    expect(MAX_FIRE_LINES).toBe(Number(m[1]));
  });
});
