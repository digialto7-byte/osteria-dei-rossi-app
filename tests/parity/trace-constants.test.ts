// Keeps the caps of src/server/trace in step with app.trace_constants() (P2-2 plan D-P12, step S9). If one side changes alone, this test fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as caps from "@/server/trace/constants";

const core = readFileSync(
  new URL("../../supabase/migrations/20261203100000_trace_core.sql", import.meta.url),
  "utf8",
);

// `'TRACE_MAX_LOTS', 50,` inside the jsonb_build_object of app.trace_constants().
function constant(name: string): number {
  const m = new RegExp(`'${name}',\\s*(\\d+)`).exec(core);
  if (!m) throw new Error(`${name}: not found in the migration`);
  return Number(m[1]);
}

describe("trace constants match app.trace_constants()", () => {
  it.each([
    "TRACE_MAX_LOTS",
    "TRACE_MAX_BATCHES",
    "TRACE_MAX_PLATE_GROUPS",
    "TRACE_MAX_LINES",
    "TRACE_MAX_RANGE_DAYS",
    "TRACE_SPLIT_DEPTH",
  ] as const)("%s", (name) => {
    expect(caps[name]).toBe(constant(name));
  });

  it("the SQL holds exactly the six caps the twin exports", () => {
    const sqlNames = [...core.matchAll(/'(TRACE_[A-Z_]+)',\s*\d+/g)].map((m) => m[1]).sort();
    expect(sqlNames).toEqual(Object.keys(caps).sort());
  });
});
