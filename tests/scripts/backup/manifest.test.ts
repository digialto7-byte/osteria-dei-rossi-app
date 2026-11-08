import { describe, expect, it } from "vitest";
import {
  buildManifest,
  compareManifests,
  parseManifest,
} from "../../../scripts/lib/backup/manifest";

const RAW = {
  migrations: ["20261021120000", "20261027100700"],
  tables: { "public.stock_movement": 12, "auth.users": 4 },
};

describe("buildManifest", () => {
  it("keeps names and integers only", () => {
    const m = buildManifest(RAW, "2026-11-05T02:15:09.000Z");
    expect(m).toEqual({ version: 1, createdAt: "2026-11-05T02:15:09.000Z", ...RAW });
    expect(JSON.stringify(m)).not.toMatch(/[@:/]\/|password|secret/i);
  });

  it("rejects anything that is not a name or an integer count", () => {
    const at = "2026-11-05T02:15:09.000Z";
    expect(() => buildManifest({ ...RAW, tables: { "public.t": 1.5 } }, at)).toThrow(
      "manifest_invalid",
    );
    expect(() => buildManifest({ ...RAW, tables: { "public.t": -1 } }, at)).toThrow(
      "manifest_invalid",
    );
    expect(() => buildManifest({ ...RAW, tables: { "public.t; drop": 1 } }, at)).toThrow(
      "manifest_invalid",
    );
    expect(() => buildManifest({ ...RAW, migrations: ["not-a-version"] }, at)).toThrow(
      "manifest_invalid",
    );
    expect(() => buildManifest(null, at)).toThrow("manifest_invalid");
    expect(() => buildManifest(RAW, "yesterday")).toThrow("manifest_invalid");
  });

  it("round-trips through parseManifest", () => {
    const m = buildManifest(RAW, "2026-11-05T02:15:09.000Z");
    expect(parseManifest(JSON.stringify(m))).toEqual(m);
    expect(() => parseManifest("{")).toThrow("manifest_invalid");
    expect(() => parseManifest(JSON.stringify({ ...m, version: 2 }))).toThrow("manifest_invalid");
  });
});

describe("compareManifests", () => {
  const a = buildManifest(RAW, "2026-11-05T02:15:09.000Z");

  it("finds no difference between equal contents, whatever the time", () => {
    expect(compareManifests(a, buildManifest(RAW, "2026-11-12T04:00:00.000Z"))).toEqual([]);
  });

  it("names a differing table", () => {
    const b = buildManifest(
      { ...RAW, tables: { "public.stock_movement": 11, "auth.users": 4 } },
      a.createdAt,
    );
    expect(compareManifests(a, b)).toEqual(["table public.stock_movement: expected 12, found 11"]);
  });

  it("names a table that is missing or extra", () => {
    const b = buildManifest(
      { ...RAW, tables: { "auth.users": 4, "public.extra": 0 } },
      a.createdAt,
    );
    expect(compareManifests(a, b)).toEqual([
      "table public.extra: expected nothing, found 0",
      "table public.stock_movement: expected 12, found nothing",
    ]);
  });

  it("names a differing migration list", () => {
    const b = buildManifest(
      { ...RAW, migrations: ["20261021120000", "20261121100000"] },
      a.createdAt,
    );
    expect(compareManifests(a, b)).toEqual([
      "migration 20261027100700: in the dump, not in the restore",
      "migration 20261121100000: in the restore, not in the dump",
    ]);
  });
});
