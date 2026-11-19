// Keeps the comanda-per-uscita constants of src/server/orders in step with 20261206220000_uscita_core.sql (plan §3.3). If one side changes
// alone, this test fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELD_FROM, USCITA_CALL_CAUSES, USCITA_MAX, USCITA_MIN } from "@/server/orders/constants";

const core = readFileSync(
  new URL("../../supabase/migrations/20261206220000_uscita_core.sql", import.meta.url),
  "utf8",
);
const found = (name: string, pattern: RegExp) => {
  const match = pattern.exec(core);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};

describe("uscite constants match the M1 migration", () => {
  it("USCITA_MIN and USCITA_MAX are the bounds of order_line_uscita_ck and of app.order_uscita", () => {
    const m = found("line", /order_line_uscita_ck check \(uscita between (\d+) and (\d+)\)/);
    expect([USCITA_MIN, USCITA_MAX]).toEqual([Number(m[1]), Number(m[2])]);
    const p = found("parser", /v <> trunc\(v\) or v < (\d+) or v > (\d+)/);
    expect([USCITA_MIN, USCITA_MAX]).toEqual([Number(p[1]), Number(p[2])]);
  });

  it("HELD_FROM is the lowest uscita a call row may name and the held rule's bound", () => {
    const m = found("call", /uscita_call_uscita_ck check \(uscita between (\d+) and (\d+)\)/);
    expect([HELD_FROM, USCITA_MAX]).toEqual([Number(m[1]), Number(m[2])]);
    expect(found("held_lines", /l\.uscita = p_uscita and p_uscita >= (\d+)/)[1]).toBe(
      String(HELD_FROM),
    );
    expect(found("line_held", /coalesce\(p_line\.uscita, 0\) >= (\d+)/)[1]).toBe(String(HELD_FROM));
  });

  it("USCITA_CALL_CAUSES are the causes of uscita_call_cause_ck, in order", () => {
    const m = found("cause", /uscita_call_cause_ck check \(cause in \(([^)]*)\)\)/);
    expect(m[1]!.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([
      ...USCITA_CALL_CAUSES,
    ]);
  });
});
