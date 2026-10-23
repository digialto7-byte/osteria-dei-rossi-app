import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapRecipeDbError } from "@/server/recipes/errors";

const err = (code: string, message: string, details?: string) =>
  mapRecipeDbError({ code, message, details }) as ApiError;

describe("mapRecipeDbError", () => {
  it.each([
    ["recipe_name_taken", 409],
    ["recipe_inactive", 409],
    ["recipe_cycle", 422],
    ["recipe_too_deep", 422],
    ["recipe_unchanged", 422],
    ["recipe_type_conflict", 422],
  ])("P0001 %s is %i with the same code and an Italian text", (code, status) => {
    const mapped = err("P0001", code);
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
  });

  it("version_conflict is 409 and names the current version in the text and in details", () => {
    const mapped = err("P0001", "version_conflict", '{"currentVersion":3}');
    expect(mapped.status).toBe(409);
    expect(mapped.code).toBe("version_conflict");
    expect(mapped.message).toContain("3");
    expect(mapped.details).toEqual([{ currentVersion: 3 }]);
  });

  it("version_conflict without a readable detail still answers 409", () => {
    const mapped = err("P0001", "version_conflict", "garbage");
    expect(mapped.status).toBe(409);
    expect(mapped.details).toBeUndefined();
  });

  it("recipe_cycle keeps no key ids out of the message", () => {
    const mapped = err("P0001", "recipe_cycle", "k1,k2,k1");
    expect(mapped.message).not.toContain("k1");
  });

  it("recipe_invalid is 422 and carries the row, field and code of each problem", () => {
    const details = JSON.stringify([
      { row: 2, field: "lines.0.yieldFactor", code: "yield_factor_not_positive" },
      { field: "name", code: "required" },
    ]);
    const mapped = err("P0001", "recipe_invalid", details);
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("recipe_invalid");
    expect(mapped.details).toEqual([
      { row: 2, field: "lines.0.yieldFactor", code: "yield_factor_not_positive" },
      { field: "name", code: "required" },
    ]);
  });

  it("drops anything in details that is not a string or number (no nested contents)", () => {
    const mapped = err(
      "P0001",
      "recipe_invalid",
      JSON.stringify([{ field: "a", code: "b", x: { y: 1 }, z: null }]),
    );
    expect(mapped.details).toEqual([{ field: "a", code: "b" }]);
  });

  it("an import problem with a file row keeps the row", () => {
    const mapped = err(
      "P0001",
      "recipe_inactive",
      JSON.stringify([{ row: 4, field: "name", code: "recipe_inactive" }]),
    );
    expect(mapped.details).toEqual([{ row: 4, field: "name", code: "recipe_inactive" }]);
  });

  it("42501 recipe_price_forbidden is 403 with its own code; any other 42501 is a plain forbidden", () => {
    const price = err("42501", "recipe_price_forbidden");
    expect(price.status).toBe(403);
    expect(price.code).toBe("recipe_price_forbidden");
    const other = err("42501", "permission denied: recipes need owner, admin or chef");
    expect(other.status).toBe(403);
    expect(other.code).toBe("forbidden");
    expect(other.message).not.toContain("permission denied");
  });

  it("P0002 is 404", () => {
    expect(err("P0002", "not_found").status).toBe(404);
  });

  it("a duplicate name caught by the unique index is 409 recipe_name_taken", () => {
    const mapped = err(
      "23505",
      'duplicate key value violates unique constraint "recipe_key_name_uq"',
    );
    expect(mapped.status).toBe(409);
    expect(mapped.code).toBe("recipe_name_taken");
  });

  it("an unknown error is a plain Error naming only the SQLSTATE", () => {
    const mapped = mapRecipeDbError({ code: "XX000", message: "secret internal detail" });
    expect(mapped).not.toBeInstanceOf(ApiError);
    expect(mapped.message).toBe("Unexpected database error XX000");
    expect(mapRecipeDbError({ message: "x" }).message).toBe("Unexpected database error (no code)");
  });

  it("an unknown P0001 message is unexpected, not echoed", () => {
    const mapped = mapRecipeDbError({ code: "P0001", message: "something odd" });
    expect(mapped).not.toBeInstanceOf(ApiError);
    expect(mapped.message).not.toContain("something odd");
  });
});
