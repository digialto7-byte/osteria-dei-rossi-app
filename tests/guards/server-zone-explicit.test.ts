import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { callsWithoutZone } from "../helpers/zone-scanner";

// SP1 step 11 (plan §3.5, R5). Server code serves every tenant at once, so it never reads a zone from the browser store: each call of a
// zone-dependent formatter under src/server/ passes the tenant's zone explicitly. A call without it falls back to the store's first-paint
// default and would format another tenant's day in Europe/Rome without anyone noticing.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the scanner", () => {
  it("flags a fixture file under a fake src/server/ that calls venueDate(now) without a zone", () => {
    const fixture =
      'import { venueDate } from "@/lib/time/venue-date";\nexport const d = venueDate(now);\n';
    expect(callsWithoutZone("src/server/fake/fixture.ts", fixture)).toEqual([
      { path: "src/server/fake/fixture.ts", line: 2, name: "venueDate" },
    ]);
  });

  it("flags each formatter by its own number of arguments", () => {
    const text = [
      "venueYear(now);",
      "formatDateTime(d);",
      "formatDateTime(d, locale);",
      "formatTime(d, locale);",
      "formatWeekdayTime(d, locale);",
      "formatCsvInstant(iso);",
      "toCsv(header, rows);",
    ].join("\n");
    expect(callsWithoutZone("src/server/fake/all.ts", text).map((f) => f.line)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("accepts calls that pass the zone, and calls of other functions", () => {
    const text = [
      "venueDate(now, zone);",
      "venueYear(now, settings.timeZone);",
      "formatDateTime(d, locale, zone);",
      "formatTime(d, locale, zone);",
      "formatWeekdayTime(d, locale, zone);",
      "formatCsvInstant(iso, zone);",
      "toCsv(header, rows, { zone });",
      "formatEuro(1);",
    ].join("\n");
    expect(callsWithoutZone("src/server/fake/ok.ts", text)).toEqual([]);
  });

  it("flags a formatter passed as a value, which would hide the missing zone", () => {
    expect(callsWithoutZone("src/server/fake/ref.ts", "dates.map(venueDate);")).toHaveLength(1);
  });

  it("flags a renamed import of a listed name, which would hide the call from the scan", () => {
    const text =
      'import { venueDate as vd, formatTime } from "@/lib/time/venue-date";\nvd(now, zone);\n';
    expect(callsWithoutZone("src/server/fake/renamed.ts", text)).toEqual([
      { path: "src/server/fake/renamed.ts", line: 1, name: "venueDate" },
    ]);
  });

  it("flags a namespace member call without the zone, and accepts one with it", () => {
    expect(callsWithoutZone("src/app/api/fake/ns.ts", "t.venueDate(now);")).toHaveLength(1);
    expect(callsWithoutZone("src/app/api/fake/ns.ts", "t.venueDate(now, zone);")).toEqual([]);
  });

  it("flags an explicit undefined (or void 0) as the zone argument", () => {
    const text = [
      "venueDate(now, undefined);",
      "formatDateTime(d, locale, undefined);",
      "toCsv(header, rows, { zone: undefined });",
      "venueYear(now, void 0);",
      "venueDate(now, zone);",
    ].join("\n");
    expect(callsWithoutZone("src/server/fake/undef.ts", text).map((f) => f.line)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("ignores members of Object.prototype that share no name with the list", () => {
    expect(
      callsWithoutZone("src/server/fake/proto.ts", "x.toString(); toString(); constructor(1);"),
    ).toEqual([]);
  });

  it("ignores imports, comments and strings", () => {
    const text = 'import { venueDate } from "x";\n// venueDate(now)\nconst s = "venueDate(now)";\n';
    expect(callsWithoutZone("src/server/fake/noise.ts", text)).toEqual([]);
  });
});

describe("the real tree", () => {
  it.each(["src/server", "src/app/api"])("has no zone-less call under %s/", (dir) => {
    const root = process.cwd();
    const found = files(join(root, dir)).flatMap((file) =>
      callsWithoutZone(relative(root, file), readFileSync(file, "utf8")),
    );
    expect(found).toEqual([]);
  });
});
