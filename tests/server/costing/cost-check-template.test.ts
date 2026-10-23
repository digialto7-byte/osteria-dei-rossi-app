import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { COST_CHECK_MAX_ROWS } from "@/server/costing/constants";
import { costCheckRowsFromCsv, costCheckRowsFromJson } from "@/server/costing/cost-check-template";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "../../fixtures/costing", name), "utf8");

describe("costCheckRowsFromCsv", () => {
  it("parses the demo sheet to the same rows as the JSON fixture, numbered by file line", () => {
    const parsed = costCheckRowsFromCsv(fixture("foglio-chef-demo.csv"));
    expect(parsed.errors).toEqual([]);
    const json = JSON.parse(fixture("foglio-chef-demo.json")) as {
      name: string;
      foodCostEur: number;
    }[];
    expect(parsed.rows).toEqual(
      json.map((plate, index) => ({
        row: index + 2,
        name: plate.name,
        sheetEur: plate.foodCostEur,
      })),
    );
  });

  it("accepts a decimal comma, a decimal point, a euro sign and thousands dots", () => {
    const parsed = costCheckRowsFromCsv("piatto;costo_cibo\nA;1,5\nB;2.25\nC;3,00 €\nD;1.234,50\n");
    expect(parsed.rows.map((r) => r.sheetEur)).toEqual([1.5, 2.25, 3, 1234.5]);
  });

  it("accepts a comma separated file", () => {
    const parsed = costCheckRowsFromCsv('piatto,costo_cibo\n"Pasta, al pomodoro",4.5\n');
    expect(parsed.rows).toEqual([{ row: 2, name: "Pasta, al pomodoro", sheetEur: 4.5 }]);
  });

  it("refuses formula cells as invalid_value without echoing them", () => {
    const parsed = costCheckRowsFromCsv("piatto;costo_cibo\n=SUM(A1);3\nB;+5\n@x;2\n");
    expect(parsed.errors).toEqual([
      { row: 2, field: "piatto", code: "invalid_value" },
      { row: 3, field: "costo_cibo", code: "invalid_value" },
      { row: 4, field: "piatto", code: "invalid_value" },
    ]);
    expect(JSON.stringify(parsed.errors)).not.toContain("SUM");
  });

  it("reports an unknown column with the header line", () => {
    const parsed = costCheckRowsFromCsv("piatto;costo_cibo;note\nA;1;x\n");
    expect(parsed.errors).toContainEqual({ row: 1, field: "header", code: "unknown_column" });
  });

  it("reports a missing column", () => {
    const parsed = costCheckRowsFromCsv("piatto\nA\n");
    expect(parsed.errors).toContainEqual({ row: 1, field: "costo_cibo", code: "missing_column" });
  });

  it("reports empty and unreadable cells by row and field", () => {
    const parsed = costCheckRowsFromCsv("piatto;costo_cibo\n;3\nB;\nC;abc\nD;-2\n");
    expect(parsed.errors).toEqual([
      { row: 2, field: "piatto", code: "required" },
      { row: 3, field: "costo_cibo", code: "required" },
      { row: 4, field: "costo_cibo", code: "invalid_value" },
      { row: 5, field: "costo_cibo", code: "invalid_value" },
    ]);
  });

  it("an unterminated quote is a malformed file", () => {
    const parsed = costCheckRowsFromCsv('piatto;costo_cibo\n"A;1\n');
    expect(parsed.errors).toEqual([{ row: 2, field: "piatto", code: "malformed_csv" }]);
  });

  it("an empty file has no rows and a missing header error", () => {
    const parsed = costCheckRowsFromCsv("");
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([{ row: 1, field: "header", code: "missing_column" }]);
  });

  it("accepts exactly the maximum number of rows and refuses one more with 413", () => {
    const body = (n: number) =>
      "piatto;costo_cibo\n" + Array.from({ length: n }, (_, i) => `P${i};1`).join("\n");
    expect(costCheckRowsFromCsv(body(COST_CHECK_MAX_ROWS)).rows).toHaveLength(COST_CHECK_MAX_ROWS);
    try {
      costCheckRowsFromCsv(body(COST_CHECK_MAX_ROWS + 1));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(413);
    }
  });
});

describe("costCheckRowsFromJson", () => {
  it("numbers rows from 1 and keeps the values", () => {
    expect(costCheckRowsFromJson([{ name: "A", foodCostEur: 2 }])).toEqual({
      rows: [{ row: 1, name: "A", sheetEur: 2 }],
      errors: [],
    });
  });

  it("refuses formula names, empty names and negative values by row", () => {
    const parsed = costCheckRowsFromJson([
      { name: "=1+1", foodCostEur: 2 },
      { name: " ", foodCostEur: 2 },
      { name: "C", foodCostEur: -1 },
    ]);
    expect(parsed.errors).toEqual([
      { row: 1, field: "piatto", code: "invalid_value" },
      { row: 2, field: "piatto", code: "required" },
      { row: 3, field: "costo_cibo", code: "invalid_value" },
    ]);
  });

  it("refuses more than the maximum number of rows with 413", () => {
    const plates = Array.from({ length: COST_CHECK_MAX_ROWS + 1 }, () => ({
      name: "A",
      foodCostEur: 1,
    }));
    expect(() => costCheckRowsFromJson(plates)).toThrow(ApiError);
  });
});
