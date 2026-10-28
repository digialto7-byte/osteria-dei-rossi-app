// Keeps the limits of the M19 TypeScript (src/server/orders, src/server/kitchen) in step with the SQL of the migrations
// 20261106100100_fire_helpers.sql, 20261106100200_fire_course.sql and 20261106100400_kitchen_tickets.sql.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KITCHEN_MAX_TICKETS } from "@/server/kitchen/constants";
import { MAX_FIRE_LINES, VOID_REASONS } from "@/server/orders/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const helpers = read("20261106100100_fire_helpers.sql");
const fire = read("20261106100200_fire_course.sql");
const kitchen = read("20261106100400_kitchen_tickets.sql");
const found = (name: string, text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};

describe("limits match the migrations", () => {
  it("MAX_FIRE_LINES is the array bound of fire_course", () => {
    const m = found("bound", fire, /jsonb_array_length\(v_arr\) not between 1 and (\d+)/);
    expect(MAX_FIRE_LINES).toBe(Number(m[1]));
  });

  it("VOID_REASONS are the codes of app.order_void_reason_codes(), in order", () => {
    const m = found(
      "reasons",
      helpers,
      /order_void_reason_codes\(\) returns text\[\][\s\S]*?select array\[([^\]]*)\]/,
    );
    expect([...m[1]!.matchAll(/'(\w+)'/g)].map((x) => x[1])).toEqual([...VOID_REASONS]);
  });

  it("every void reason has a waste code in void_waste_reason", () => {
    for (const reason of VOID_REASONS) expect(helpers).toContain(`when '${reason}' then`);
  });

  it("KITCHEN_MAX_TICKETS is the cap of the ticket list", () => {
    const cap = found("cap", kitchen, /'truncated', coalesce\(max\(r\.total\), 0\) > (\d+)/);
    const rn = found("rn", kitchen, /where r\.rn <= (\d+)/);
    expect(KITCHEN_MAX_TICKETS).toBe(Number(cap[1]));
    expect(KITCHEN_MAX_TICKETS).toBe(Number(rn[1]));
  });
});
