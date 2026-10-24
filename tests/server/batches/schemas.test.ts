import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import {
  idParams,
  parseBatchCursor,
  parseBatchesQuery,
  parseProposalQuery,
  produceBody,
} from "@/server/batches/schemas";

const RECIPE = "ed000000-0000-4000-8000-0000000000d1";
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const BEEF = "1a000000-0000-4000-8000-00000000001a";
const ONION = "1b000000-0000-4000-8000-00000000001b";
const CARROT = "1c000000-0000-4000-8000-00000000001c";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const LOT = "10700000-0000-4000-8000-0000000000a1";
const BATCH = "ba000000-0000-4000-8000-0000000000b1";

const input = (ingredientId: string, qty: number, extra: object = {}) => ({
  ingredientId,
  qty,
  unit: "kg",
  ...extra,
});
const body = (over: object = {}) => ({
  recipeId: RECIPE,
  outputQty: 6.2,
  inputs: [input(BEEF, 5.3), input(ONION, 0.31), input(CARROT, 0.2067)],
  ...over,
});

describe("produceBody", () => {
  it("accepts the AT1 body and keeps the optional fields optional", () => {
    const parsed = produceBody.parse(body());
    expect(parsed.inputs).toHaveLength(3);
    expect(parsed.portions).toBeUndefined();
    expect(
      produceBody.parse(
        body({
          portions: 30,
          shelfLifeHours: 48,
          locationId: CELLA,
          inputs: [input(BEEF, 5.3, { locationId: CELLA, lotId: LOT })],
        }),
      ).portions,
    ).toBe(30);
  });

  it("is strict: an unknown key at the top or in an input is refused", () => {
    expect(produceBody.safeParse(body({ colour: "red" })).success).toBe(false);
    expect(produceBody.safeParse(body({ inputs: [input(BEEF, 1, { price: 3 })] })).success).toBe(
      false,
    );
  });

  it("limits the output to 1..100000 with at most 4 decimals", () => {
    for (const outputQty of [0, -1, 100_001, 1.23456, Number.NaN]) {
      expect(produceBody.safeParse(body({ outputQty })).success, String(outputQty)).toBe(false);
    }
    for (const outputQty of [0.0001, 6.2, 100_000]) {
      expect(produceBody.safeParse(body({ outputQty })).success, String(outputQty)).toBe(true);
    }
  });

  it("refuses an input quantity with 5 decimals, accepts 0, refuses a negative one", () => {
    const withQty = (qty: number) => produceBody.safeParse(body({ inputs: [input(BEEF, qty)] }));
    expect(withQty(0.12345).success).toBe(false);
    expect(withQty(0).success).toBe(true);
    expect(withQty(-0.5).success).toBe(false);
    expect(withQty(0.0001).success).toBe(true);
  });

  it("takes 1 to 100 inputs", () => {
    expect(produceBody.safeParse(body({ inputs: [] })).success).toBe(false);
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        input(`1a000000-0000-4000-8000-${String(i).padStart(12, "0")}`, 1),
      );
    expect(produceBody.safeParse(body({ inputs: many(100) })).success).toBe(true);
    expect(produceBody.safeParse(body({ inputs: many(101) })).success).toBe(false);
  });

  it("allows only the five input units", () => {
    for (const unit of ["kg", "g", "l", "ml", "pz"]) {
      expect(produceBody.safeParse(body({ inputs: [{ ...input(BEEF, 1), unit }] })).success).toBe(
        true,
      );
    }
    expect(
      produceBody.safeParse(body({ inputs: [{ ...input(BEEF, 1), unit: "conf" }] })).success,
    ).toBe(false);
    expect(produceBody.safeParse(body({ inputs: [{ ingredientId: BEEF, qty: 1 }] })).success).toBe(
      false,
    );
  });

  it("wants uuids for the recipe, the ingredients, the locations and the lot", () => {
    expect(produceBody.safeParse(body({ recipeId: "x" })).success).toBe(false);
    expect(produceBody.safeParse(body({ inputs: [input("x", 1)] })).success).toBe(false);
    expect(produceBody.safeParse(body({ locationId: "x" })).success).toBe(false);
    expect(produceBody.safeParse(body({ inputs: [input(BEEF, 1, { lotId: "x" })] })).success).toBe(
      false,
    );
  });

  it("bounds the portions (1..10000, whole) and the shelf life (1..8760 hours, whole)", () => {
    for (const portions of [0, 10_001, 1.5]) {
      expect(produceBody.safeParse(body({ portions })).success, String(portions)).toBe(false);
    }
    for (const shelfLifeHours of [0, 8761, 1.5]) {
      expect(produceBody.safeParse(body({ shelfLifeHours })).success, String(shelfLifeHours)).toBe(
        false,
      );
    }
    expect(produceBody.safeParse(body({ portions: 10_000, shelfLifeHours: 8760 })).success).toBe(
      true,
    );
  });
});

const url = (query: string) => new URL(`http://localhost:3000/api/batches/proposal${query}`);

describe("parseProposalQuery", () => {
  it("reads the recipe key, the output and the shelf life", () => {
    expect(parseProposalQuery(url(`?recipeKey=${KEY}&outputQty=6.2&shelfLifeHours=48`))).toEqual({
      recipeKey: KEY,
      outputQty: 6.2,
      shelfLifeHours: 48,
    });
    expect(parseProposalQuery(url(`?recipeKey=${KEY}`))).toEqual({
      recipeKey: KEY,
      outputQty: null,
      shelfLifeHours: null,
    });
  });

  it.each([
    ["", "no recipe key"],
    [`?recipeKey=nope`, "a malformed key"],
    [`?recipeKey=${KEY}&extra=1`, "an unknown parameter"],
    [`?recipeKey=${KEY}&recipeKey=${KEY}`, "a repeated parameter"],
    [`?recipeKey=${KEY}&outputQty=6,2`, "a decimal comma"],
    [`?recipeKey=${KEY}&outputQty=1.23456`, "5 decimals"],
    [`?recipeKey=${KEY}&outputQty=0`, "zero"],
    [`?recipeKey=${KEY}&outputQty=100001`, "above the maximum"],
    [`?recipeKey=${KEY}&outputQty=`, "an empty output"],
    [`?recipeKey=${KEY}&outputQty=1e3`, "an exponent"],
    [`?recipeKey=${KEY}&shelfLifeHours=0`, "a shelf life of 0"],
    [`?recipeKey=${KEY}&shelfLifeHours=8761`, "a shelf life above the maximum"],
    [`?recipeKey=${KEY}&shelfLifeHours=1.5`, "a fractional shelf life"],
  ])("%s is a 400 (%s)", (query) => {
    expect(() => parseProposalQuery(url(query))).toThrow(ApiError);
    try {
      parseProposalQuery(url(query));
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    }
  });
});

describe("parseBatchesQuery and the cursor", () => {
  const CURSOR = `2026-10-23T10:00:00.123456+00:00_${BATCH}`;

  it("reads the recipe key and a cursor of the shape <ISO instant>_<uuid>", () => {
    expect(parseBatchCursor(CURSOR)).toEqual({
      producedAt: "2026-10-23T10:00:00.123456+00:00",
      id: BATCH,
    });
    expect(parseBatchCursor(`2026-10-23T10:00:00Z_${BATCH}`)).toEqual({
      producedAt: "2026-10-23T10:00:00Z",
      id: BATCH,
    });
    const query = parseBatchesQuery(
      new URL(`http://localhost/api/batches?recipeKey=${KEY}&before=${encodeURIComponent(CURSOR)}`),
    );
    expect(query.recipeKey).toBe(KEY);
    expect(query.before?.id).toBe(BATCH);
    expect(parseBatchesQuery(new URL("http://localhost/api/batches"))).toEqual({
      recipeKey: null,
      before: null,
    });
  });

  it.each([
    "2026-10-23_" + BATCH,
    `2026-10-23T10:00:00Z_nope`,
    `2026-10-23T10:00:00Z ${BATCH}`,
    `x2026-10-23T10:00:00Z_${BATCH}`,
    `2026-10-23T10:00:00Z_${BATCH}; drop table batch`,
    "",
  ])("the cursor %j is refused", (text) => {
    expect(parseBatchCursor(text)).toBeNull();
    expect(() =>
      parseBatchesQuery(new URL(`http://localhost/api/batches?before=${encodeURIComponent(text)}`)),
    ).toThrow(ApiError);
  });

  it("refuses unknown and repeated parameters", () => {
    expect(() => parseBatchesQuery(new URL("http://localhost/api/batches?limit=5"))).toThrow(
      ApiError,
    );
    expect(() =>
      parseBatchesQuery(new URL(`http://localhost/api/batches?recipeKey=${KEY}&recipeKey=${KEY}`)),
    ).toThrow(ApiError);
  });
});

describe("idParams", () => {
  it("wants a uuid", () => {
    expect(idParams.safeParse({ id: BATCH }).success).toBe(true);
    expect(idParams.safeParse({ id: "nope" }).success).toBe(false);
  });
});
