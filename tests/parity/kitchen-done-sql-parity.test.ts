// Keeps the constants of the M19b TypeScript (src/server/kitchen) in step with the SQL of the migrations
// 20261111100100_kitchen_event_helpers.sql and 20261111100200_kitchen_board.sql.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIRED_AT_RE, KITCHEN_MAX_TICKETS } from "@/server/kitchen/constants";
import { COURSES } from "@/server/orders/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const helpers = read("20261111100100_kitchen_event_helpers.sql");
const board = read("20261111100200_kitchen_board.sql");

describe("limits match the migrations", () => {
  it("FIRED_AT_RE is the pattern app.kitchen_ticket_key applies", () => {
    const match = /v_fired !~ '([^']+)'/.exec(helpers);
    expect(match).not.toBeNull();
    expect(FIRED_AT_RE.source).toBe(match![1]!.replace(/\\\./g, "\\.").replace(/\\\//g, "/"));
  });

  it("KITCHEN_MAX_TICKETS is both caps of app.kitchen_ticket_rows", () => {
    const caps = [...board.matchAll(/(?:rn_active|rn_closed) <= (\d+)/g)].map((m) => Number(m[1]));
    expect(caps).toEqual([KITCHEN_MAX_TICKETS, KITCHEN_MAX_TICKETS]);
    expect(board).toContain(`r.total > ${KITCHEN_MAX_TICKETS}`);
  });

  it("the course list is the enum the key parser reads", () => {
    expect(helpers).toContain("enum_range(null::public.course)");
    expect(COURSES.length).toBeGreaterThan(0);
  });
});
