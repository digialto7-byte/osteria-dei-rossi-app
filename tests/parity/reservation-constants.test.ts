// Keeps the constants of the reservation TypeScript (src/server/reservations) in step with the SQL of the migrations 20261124100000_reservation_core.sql and
// 20261124100200_reservation_settings.sql (reservations plan step A8). The SQL stays the authority; the TS only turns the obvious mistakes into a 400 first.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GROUP_INVALID_REASONS,
  GROUP_NAME_MAX,
  GROUP_SEATS_MAX,
  GROUP_SEATS_MIN,
  GROUP_TABLES_MAX,
  GROUP_TABLES_MIN,
  MAX_CLOSED_DATES,
  NOT_READY_REASONS,
  RESERVATION_LIMIT_MAX,
  SETTINGS_INVALID_REASONS,
  SLOT_MINUTES,
  SLUG_PATTERN,
  TABLE_BOOKING_INVALID_REASONS,
  TABLE_BOOKING_MAX_ENTRIES,
  TABLE_SEATS_MAX,
  TIME_PATTERN,
  VENUE_PHONE_PATTERN,
  SETTINGS_RANGES,
} from "@/server/reservations/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const core = read("20261124100000_reservation_core.sql");
const settings = read("20261124100200_reservation_settings.sql");
const found = (name: string, text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};
const column = (name: string) =>
  found(
    name,
    core,
    new RegExp(
      `${name} smallint not null default \\d+ check \\(${name} (?:between (\\d+) and (\\d+)|in \\(([\\d, ]+)\\))\\)`,
    ),
  );

describe("settings bounds match the migration", () => {
  it.each([
    ["stay_minutes", "stayMinutes"],
    ["lead_minutes", "leadMinutes"],
    ["horizon_days", "horizonDays"],
    ["max_party_online", "maxPartyOnline"],
    ["cancel_until_minutes", "cancelUntilMinutes"],
    ["retention_days", "retentionDays"],
  ] as const)("%s is the range of %s", (sql, key) => {
    const m = column(sql);
    expect(SETTINGS_RANGES[key]).toEqual({ min: Number(m[1]), max: Number(m[2]) });
  });

  it("slot_minutes is one of the same three values", () => {
    const m = column("slot_minutes");
    expect([...SLOT_MINUTES]).toEqual(m[3]!.split(",").map((n) => Number(n.trim())));
  });

  it("the writer repeats each range (reservation_int) as the table check has it", () => {
    const calls = [...settings.matchAll(/reservation_int\(p_body -> '(\w+)', (\d+), (\d+)\)/g)];
    const seen = Object.fromEntries(
      calls.map((c) => [c[1], { min: Number(c[2]), max: Number(c[3]) }]),
    );
    for (const [key, range] of Object.entries(SETTINGS_RANGES)) {
      expect(seen[key], key).toEqual(range);
    }
    expect(seen.slotMinutes).toEqual({ min: 15, max: 60 });
  });

  it("the slug pattern is the column check and the writer's", () => {
    const check = found(
      "slug check",
      core,
      /public_slug text unique check \(public_slug ~ '([^']+)'\)/,
    );
    expect(new RegExp(check[1]!).source).toBe(SLUG_PATTERN.source);
    const writer = found("slug writer", settings, /\(p_body ->> 'publicSlug'\) ~ '([^']+)'/);
    expect(new RegExp(writer[1]!).source).toBe(SLUG_PATTERN.source);
  });

  it("the venue phone pattern is the column check and the writer's", () => {
    const check = found("phone check", core, /venue_phone text check \(venue_phone ~ '([^']+)'\)/);
    expect(new RegExp(check[1]!).source).toBe(VENUE_PHONE_PATTERN.source);
    const writer = found("phone writer", settings, /\(p_body ->> 'venuePhone'\) ~ '([^']+)'/);
    expect(new RegExp(writer[1]!).source).toBe(VENUE_PHONE_PATTERN.source);
  });

  it("closed dates are at most the column's cardinality", () => {
    const m = found("closed dates", core, /cardinality\(closed_dates\) <= (\d+)/);
    expect(MAX_CLOSED_DATES).toBe(Number(m[1]));
  });

  it("HH:MM and the service limits are the validator's", () => {
    const m = found("time", core, /\(v ->> 'firstSeating'\) ~ '([^']+)'/);
    expect(new RegExp(m[1]!).source).toBe(TIME_PATTERN.source);
    const limit = found("limit", core, /\(v ->> f\)::integer not between 1 and (\d+)/);
    expect(RESERVATION_LIMIT_MAX).toBe(Number(limit[1]));
  });
});

describe("table and group bounds match the migrations", () => {
  it("seats of a table", () => {
    const m = found("table seats", core, /seats smallint check \(seats between 1 and (\d+)\)/);
    expect(TABLE_SEATS_MAX).toBe(Number(m[1]));
    expect(settings).toContain(`reservation_int(e -> 'seats', 1, ${TABLE_SEATS_MAX})`);
  });

  it("seats and name of a group", () => {
    const m = found(
      "group seats",
      core,
      /seats smallint not null check \(seats between (\d+) and (\d+)\)/,
    );
    expect([GROUP_SEATS_MIN, GROUP_SEATS_MAX]).toEqual([Number(m[1]), Number(m[2])]);
    const n = found("group name", core, /char_length\(btrim\(name\)\) between 1 and (\d+)/);
    expect(GROUP_NAME_MAX).toBe(Number(n[1]));
    const w = found(
      "group tables",
      settings,
      /jsonb_array_length\(v_ids\) not between (\d+) and (\d+)/,
    );
    expect([GROUP_TABLES_MIN, GROUP_TABLES_MAX]).toEqual([Number(w[1]), Number(w[2])]);
  });

  it("at most this many tables in one save", () => {
    const m = found("entries", settings, /jsonb_array_length\(v_in\) not between 1 and (\d+)/);
    expect(TABLE_BOOKING_MAX_ENTRIES).toBe(Number(m[1]));
  });
});

describe("reason codes match what the writers raise", () => {
  it("reservation_settings_invalid reasons are the fields of the writer", () => {
    const reasons = [...settings.matchAll(/reservation_settings_fail\('(\w+)'\)/g)].map(
      (x) => x[1],
    );
    expect([...new Set(reasons)].sort()).toEqual([...SETTINGS_INVALID_REASONS].sort());
  });

  it("reservations_not_ready reasons are the ones reservation_not_ready lists", () => {
    const reasons = [...settings.matchAll(/then '(\w+)' end/g)].map((x) => x[1]);
    expect(reasons).toEqual([...NOT_READY_REASONS]);
  });

  it("group_invalid and table_booking_invalid reasons", () => {
    const group = [
      ...settings.matchAll(
        /'group_invalid' using errcode = 'P0001', detail = '\{"reason": "(\w+)"\}'/g,
      ),
    ].map((x) => x[1]);
    expect([...new Set(group)].sort()).toEqual([...GROUP_INVALID_REASONS].sort());
    const booking = [
      ...settings.matchAll(
        /'table_booking_invalid' using errcode = 'P0001', detail = '\{"reason": "(\w+)"\}'/g,
      ),
    ].map((x) => x[1]);
    expect([...new Set(booking)].sort()).toEqual([...TABLE_BOOKING_INVALID_REASONS].sort());
  });
});
