import { describe, expect, it } from "vitest";
import { registry } from "@/server/exports/registry";
import { csvFileName, csvResponse } from "@/server/exports/respond";
import { KPI_REPORT } from "../../fixtures/exports";

describe("csvFileName (plan §6: the name is a slug and ISO dates only)", () => {
  it("builds report-<slug>-<range>.csv", () => {
    expect(csvFileName("kpis", "2026-10-01_2026-10-31")).toBe(
      "report-kpis-2026-10-01_2026-10-31.csv",
    );
    expect(csvFileName("count-variance", "2026-10-31")).toBe(
      "report-count-variance-2026-10-31.csv",
    );
  });

  it.each([
    ["kpis", '2026-10-01"; evil=1'],
    ["kpis", "../../etc/passwd"],
    ["kpis", "2026 10"],
    ["kpis", "ottobre-è"],
    ["kpis", "a\r\nSet-Cookie: x"],
    ["kpis", ""],
    ["k/pis", "2026-10-01"],
    ["", "2026-10-01"],
  ])("refuses %j / %j", (slug, range) => {
    expect(() => csvFileName(slug, range)).toThrow();
  });
});

describe("csvResponse", () => {
  it("is a 200 UTF-8 CSV attachment with the timing header", async () => {
    const response = csvResponse(registry.kpis, KPI_REPORT, "owner", "auth;dur=1.0");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="report-kpis-2026-11-04_2026-11-04.csv"',
    );
    expect(response.headers.get("server-timing")).toBe("auth;dur=1.0");
    expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 3)]).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
  });
});
