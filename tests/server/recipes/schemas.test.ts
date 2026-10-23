import { describe, expect, it } from "vitest";
import { ApiError, type ErrorDetail } from "@/lib/api/errors";
import { MAX_RECIPE_LINES, MAX_YIELD_FACTOR } from "@/server/recipes/constants";
import {
  assertValidRecipeContent,
  createRecipeBody,
  newVersionBody,
  setActiveBody,
  validateRecipeContent,
} from "@/server/recipes/schemas";

const ING = "1a000000-0000-4000-8000-00000000001a";
const SUB = "2b000000-0000-4000-8000-00000000002b";
const line = { ingredientId: ING, qty: 5, unit: "kg" };
const batch = {
  name: "Spezzatino (demo)",
  outputQty: 6,
  outputUnit: "kg",
  portionsPerBatch: 30,
  shelfLifeHours: 72,
  lines: [line],
};
const plate = { name: "Spezzatino con polenta (demo)", salePrice: 12, lines: [line] };

const codes = (details: ErrorDetail[]) => details.map((d) => `${d.field}:${d.code}`);

describe("body shapes (400 when wrong)", () => {
  it("accepts a create body with a type and the content", () => {
    expect(createRecipeBody.safeParse({ type: "batch", ...batch }).success).toBe(true);
  });

  it("refuses an extra key, an unknown type and a string for a number", () => {
    expect(createRecipeBody.safeParse({ type: "batch", ...batch, extra: 1 }).success).toBe(false);
    expect(createRecipeBody.safeParse({ type: "menu", ...batch }).success).toBe(false);
    expect(createRecipeBody.safeParse({ type: "batch", ...batch, outputQty: "6" }).success).toBe(
      false,
    );
    const textYield = { ...batch, lines: [{ ...line, yieldFactor: "0.8" }] };
    expect(createRecipeBody.safeParse({ type: "batch", ...textYield }).success).toBe(false);
  });

  it("refuses an extra key inside a line and a non-uuid target", () => {
    const extra = { ...batch, lines: [{ ...line, price: 1 }] };
    expect(createRecipeBody.safeParse({ type: "batch", ...extra }).success).toBe(false);
    const bad = { ...batch, lines: [{ ...line, ingredientId: "x" }] };
    expect(createRecipeBody.safeParse({ type: "batch", ...bad }).success).toBe(false);
  });

  it("lets yield 0, -1 and 82 through the shape: they are domain errors (422), not shape errors", () => {
    for (const yieldFactor of [0, -1, 82]) {
      const body = { ...batch, lines: [{ ...line, yieldFactor }] };
      expect(createRecipeBody.safeParse({ type: "batch", ...body }).success).toBe(true);
    }
  });

  it("refuses Infinity and NaN as numbers", () => {
    const body = { ...batch, lines: [{ ...line, qty: Number.POSITIVE_INFINITY }] };
    expect(createRecipeBody.safeParse({ type: "batch", ...body }).success).toBe(false);
  });

  it("a new version needs a base version of 1 or more, a whole number", () => {
    expect(newVersionBody.safeParse({ baseVersion: 1, ...batch }).success).toBe(true);
    expect(newVersionBody.safeParse(batch).success).toBe(false);
    expect(newVersionBody.safeParse({ baseVersion: 0, ...batch }).success).toBe(false);
    expect(newVersionBody.safeParse({ baseVersion: 1.5, ...batch }).success).toBe(false);
  });

  it("the active toggle takes a boolean and nothing else", () => {
    expect(setActiveBody.safeParse({ isActive: false }).success).toBe(true);
    expect(setActiveBody.safeParse({ isActive: "no" }).success).toBe(false);
    expect(setActiveBody.safeParse({}).success).toBe(false);
  });

  it("accepts null prices (clear) and a sub-recipe line", () => {
    const body = {
      ...plate,
      salePrice: null,
      targetGpPct: null,
      lines: [{ recipeKey: SUB, qty: 1, unit: "porz" }],
    };
    expect(createRecipeBody.safeParse({ type: "plate", ...body }).success).toBe(true);
  });
});

describe("domain rules (422 recipe_invalid)", () => {
  it("accepts a valid batch and a valid plate", () => {
    expect(validateRecipeContent("batch", batch)).toEqual([]);
    expect(validateRecipeContent("plate", plate)).toEqual([]);
  });

  // AT3
  it("refuses a yield factor of 0 or below with yield_factor_not_positive", () => {
    for (const yieldFactor of [0, -1, -0.5]) {
      const details = validateRecipeContent("batch", {
        ...batch,
        lines: [{ ...line, yieldFactor }],
      });
      expect(codes(details)).toEqual(["lines.0.yieldFactor:yield_factor_not_positive"]);
    }
  });

  it("refuses a yield factor above the bound with yield_factor_too_large, accepts the bound and 1.5", () => {
    const at = (yieldFactor: number) =>
      validateRecipeContent("batch", { ...batch, lines: [{ ...line, yieldFactor }] });
    expect(codes(at(11))).toEqual(["lines.0.yieldFactor:yield_factor_too_large"]);
    expect(codes(at(MAX_YIELD_FACTOR + 0.0001))).toEqual([
      "lines.0.yieldFactor:yield_factor_too_large",
    ]);
    expect(at(MAX_YIELD_FACTOR)).toEqual([]);
    expect(at(1.5)).toEqual([]);
  });

  it("points at the right line", () => {
    const body = { ...batch, lines: [line, { ...line, yieldFactor: 0 }] };
    expect(codes(validateRecipeContent("batch", body))).toEqual([
      "lines.1.yieldFactor:yield_factor_not_positive",
    ]);
  });

  it("requires the batch fields and refuses fields that do not belong to the type", () => {
    const { portionsPerBatch: _p, shelfLifeHours: _s, ...rest } = batch;
    expect(codes(validateRecipeContent("batch", rest))).toEqual([
      "portionsPerBatch:required",
      "shelfLifeHours:required",
    ]);
    expect(
      codes(validateRecipeContent("plate", { ...plate, outputQty: 1, outputUnit: "kg" })),
    ).toEqual(["outputQty:field_not_for_type", "outputUnit:field_not_for_type"]);
    expect(codes(validateRecipeContent("batch", { ...batch, salePrice: 5 }))).toEqual([
      "salePrice:price_not_for_type",
    ]);
    expect(
      codes(
        validateRecipeContent("sub", {
          name: "Polenta (demo)",
          outputQty: 1,
          outputUnit: "kg",
          portionsPerBatch: 3,
          lines: [line],
        }),
      ),
    ).toEqual(["portionsPerBatch:field_not_for_type"]);
  });

  it("checks ranges, whole numbers and target >= min portions", () => {
    expect(codes(validateRecipeContent("batch", { ...batch, shelfLifeHours: 0 }))).toEqual([
      "shelfLifeHours:invalid_value",
    ]);
    expect(codes(validateRecipeContent("batch", { ...batch, shelfLifeHours: 8761 }))).toEqual([
      "shelfLifeHours:invalid_value",
    ]);
    expect(codes(validateRecipeContent("batch", { ...batch, portionsPerBatch: 2.5 }))).toEqual([
      "portionsPerBatch:invalid_value",
    ]);
    expect(codes(validateRecipeContent("batch", { ...batch, outputQty: 0 }))).toEqual([
      "outputQty:invalid_value",
    ]);
    expect(
      codes(validateRecipeContent("batch", { ...batch, minPortions: 10, targetPortions: 5 })),
    ).toEqual(["targetPortions:invalid_value"]);
    expect(codes(validateRecipeContent("plate", { ...plate, targetGpPct: 100 }))).toEqual([
      "targetGpPct:invalid_value",
    ]);
    expect(codes(validateRecipeContent("plate", { ...plate, salePrice: 12.345 }))).toEqual([
      "salePrice:invalid_value",
    ]);
    expect(validateRecipeContent("plate", { ...plate, targetGpPct: 99.99 })).toEqual([]);
  });

  it("refuses a blank name and a name over 120 characters", () => {
    expect(codes(validateRecipeContent("plate", { ...plate, name: "  " }))).toEqual([
      "name:required",
    ]);
    expect(codes(validateRecipeContent("plate", { ...plate, name: "x".repeat(121) }))).toEqual([
      "name:invalid_value",
    ]);
  });

  it("checks the lines: none, too many, quantity, one target exactly", () => {
    expect(codes(validateRecipeContent("plate", { ...plate, lines: [] }))).toEqual([
      "lines:no_lines",
    ]);
    const many = Array.from({ length: MAX_RECIPE_LINES + 1 }, () => line);
    expect(codes(validateRecipeContent("plate", { ...plate, lines: many }))).toEqual([
      "lines:too_many_lines",
    ]);
    expect(
      codes(validateRecipeContent("plate", { ...plate, lines: [{ ...line, qty: 0 }] })),
    ).toEqual(["lines.0.qty:qty_not_positive"]);
    expect(
      codes(validateRecipeContent("plate", { ...plate, lines: [{ ...line, qty: 100001 }] })),
    ).toEqual(["lines.0.qty:invalid_value"]);
    expect(
      codes(validateRecipeContent("plate", { ...plate, lines: [{ qty: 1, unit: "kg" }] })),
    ).toEqual(["lines.0:line_target_required"]);
    expect(
      codes(validateRecipeContent("plate", { ...plate, lines: [{ ...line, recipeKey: SUB }] })),
    ).toEqual(["lines.0:line_target_required"]);
  });

  it("assertValidRecipeContent throws a 422 ApiError carrying field and code, nothing else", () => {
    let thrown: unknown;
    try {
      assertValidRecipeContent("batch", { ...batch, lines: [{ ...line, yieldFactor: 0 }] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const error = thrown as ApiError;
    expect(error.status).toBe(422);
    expect(error.code).toBe("recipe_invalid");
    expect(error.details).toEqual([
      { field: "lines.0.yieldFactor", code: "yield_factor_not_positive" },
    ]);
    expect(() => assertValidRecipeContent("batch", batch)).not.toThrow();
  });
});
