import { describe, expect, it } from "vitest";
import { EXPORT_SLUGS } from "@/server/exports/types";
import { canExport } from "@/lib/exports/export-access";
import { csvHref, csvHrefForEndpoint } from "@/lib/exports/export-links";

describe("csvHref", () => {
  it("builds /api/exports/<slug>.csv with the screen's query", () => {
    expect(csvHref("kpis", "period=month&date=2026-10-15")).toBe(
      "/api/exports/kpis.csv?period=month&date=2026-10-15",
    );
  });

  it("has no query mark without a query", () => {
    expect(csvHref("avt")).toBe("/api/exports/avt.csv");
    expect(csvHref("avt", "")).toBe("/api/exports/avt.csv");
  });

  it("builds the query from a record, in order, leaving out empty values", () => {
    expect(csvHref("reconciliation", { from: "2026-10-01", to: "2026-10-31", location: "" })).toBe(
      "/api/exports/reconciliation.csv?from=2026-10-01&to=2026-10-31",
    );
    expect(csvHref("reconciliation", { from: "2026-10-01", to: null, location: "abc-1" })).toBe(
      "/api/exports/reconciliation.csv?from=2026-10-01&location=abc-1",
    );
  });

  it("encodes a value (no query injection through a value)", () => {
    expect(csvHref("avt", { count: "a&b=c" })).toBe("/api/exports/avt.csv?count=a%26b%3Dc");
  });

  it("points at a slug of the registry for every slug", () => {
    for (const slug of EXPORT_SLUGS) expect(csvHref(slug)).toBe(`/api/exports/${slug}.csv`);
  });
});

describe("csvHrefForEndpoint: the CSV of the JSON request a screen makes", () => {
  it.each([
    ["/api/reports/kpis?period=day", "/api/exports/kpis.csv?period=day"],
    [
      "/api/reports/items?period=custom&from=2026-10-01&to=2026-10-31",
      "/api/exports/items.csv?period=custom&from=2026-10-01&to=2026-10-31",
    ],
    ["/api/reports/avt", "/api/exports/avt.csv"],
    [
      "/api/reports/avt?count=c5000000-0000-4000-8000-000000000002",
      "/api/exports/avt.csv?count=c5000000-0000-4000-8000-000000000002",
    ],
    [
      "/api/reports/unmapped-items?week=2026-11-04",
      "/api/exports/unmapped-items.csv?week=2026-11-04",
    ],
    [
      "/api/reports/discards-vs-push?week=2026-11-04",
      "/api/exports/discards-vs-push.csv?week=2026-11-04",
    ],
    ["/api/reports/push-list", "/api/exports/push-list.csv"],
    [
      "/api/stock/waste-costs?from=2026-10-01&to=2026-10-31",
      "/api/exports/waste-costs.csv?from=2026-10-01&to=2026-10-31",
    ],
    ["/api/reports/reconciliation?location=x", "/api/exports/reconciliation.csv?location=x"],
  ])("%s -> %s", (json, csv) => {
    expect(csvHrefForEndpoint(json)).toBe(csv);
  });

  it.each(["/api/reports/forecast", "/api/reports/extraction-quality", "/api/me", "", "kpis"])(
    "%j has no CSV (null)",
    (json) => {
      expect(csvHrefForEndpoint(json)).toBeNull();
    },
  );
});

describe("canExport", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    ["chef", false],
    ["waiter", false],
    [undefined, false],
    [null, false],
    ["", false],
    ["Owner", false],
  ])("%j -> %s", (role, expected) => {
    expect(canExport(role as string | undefined | null)).toBe(expected);
  });
});
