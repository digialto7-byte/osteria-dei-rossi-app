import { describe, expect, it } from "vitest";
import {
  addLine,
  emptyForm,
  fieldsFor,
  formErrorsFromApi,
  formFromDetail,
  formToBody,
  removeLine,
  targetTypesFor,
} from "@/lib/recipes/recipe-form";
import type { RecipeDetail } from "@/server/recipes/detail";

const ING = "1a000000-0000-4000-8000-00000000001a";
const SUB = "2b000000-0000-4000-8000-00000000002b";

describe("fieldsFor", () => {
  it("a batch has output, portions, shelf life, prep time and the par levels, but no price", () => {
    expect(fieldsFor("batch")).toEqual([
      "outputQty",
      "outputUnit",
      "portionsPerBatch",
      "shelfLifeHours",
      "prepTimeMin",
      "minPortions",
      "targetPortions",
    ]);
  });

  it("a sub-recipe has output and prep time; a plate has only the price fields", () => {
    expect(fieldsFor("sub")).toEqual(["outputQty", "outputUnit", "prepTimeMin"]);
    expect(fieldsFor("plate")).toEqual(["salePrice", "targetGpPct"]);
  });
});

describe("targetTypesFor", () => {
  it("only a plate may use a batch; nothing uses a plate", () => {
    expect(targetTypesFor("plate")).toEqual(["sub", "batch"]);
    expect(targetTypesFor("batch")).toEqual(["sub"]);
    expect(targetTypesFor("sub")).toEqual(["sub"]);
  });
});

describe("formToBody", () => {
  const filled = () => ({
    ...emptyForm("batch"),
    name: " Spezzatino (demo) ",
    outputQty: "6",
    outputUnit: "kg",
    portionsPerBatch: "30",
    shelfLifeHours: "72",
    prepTimeMin: "180",
    lines: [{ target: `i:${ING}`, qty: "5", unit: "kg", yieldFactor: "1" }],
  });

  it("turns text into the API body, reading the decimal comma", () => {
    const state = filled();
    state.lines.push({ target: `r:${SUB}`, qty: "0,2", unit: "kg", yieldFactor: "0,82" });
    const result = formToBody(state, "batch", { canEditPrice: false });
    expect(result).toEqual({
      ok: true,
      body: {
        name: "Spezzatino (demo)",
        outputQty: 6,
        outputUnit: "kg",
        portionsPerBatch: 30,
        shelfLifeHours: 72,
        prepTimeMin: 180,
        lines: [
          { ingredientId: ING, qty: 5, unit: "kg", yieldFactor: 1 },
          { recipeKey: SUB, qty: 0.2, unit: "kg", yieldFactor: 0.82 },
        ],
      },
    });
  });

  it("leaves out fields the type does not use and blank optional fields", () => {
    const state = { ...filled(), salePrice: "12", minPortions: "" };
    const result = formToBody(state, "batch", { canEditPrice: true });
    expect(result.ok && Object.keys(result.body)).not.toContain("salePrice");
    expect(result.ok && Object.keys(result.body)).not.toContain("minPortions");
  });

  it("a blank yield is left to the server's default of 1", () => {
    const state = filled();
    state.lines[0]!.yieldFactor = "";
    const result = formToBody(state, "batch", { canEditPrice: false });
    expect(result.ok && result.body.lines[0]).not.toHaveProperty("yieldFactor");
  });

  it("never sends a price key when the caller cannot edit the price (the chef)", () => {
    const state = {
      ...emptyForm("plate"),
      name: "P",
      salePrice: "12",
      targetGpPct: "70",
      lines: filled().lines,
    };
    const chef = formToBody(state, "plate", { canEditPrice: false });
    expect(chef.ok && Object.keys(chef.body)).not.toContain("salePrice");
    expect(chef.ok && Object.keys(chef.body)).not.toContain("targetGpPct");
    const owner = formToBody(state, "plate", { canEditPrice: true });
    expect(owner.ok && owner.body).toMatchObject({ salePrice: 12, targetGpPct: 70 });
  });

  it("a blank price keeps the stored one: the key is left out", () => {
    const state = { ...emptyForm("plate"), name: "P", lines: filled().lines };
    const owner = formToBody(state, "plate", { canEditPrice: true });
    expect(owner.ok && Object.keys(owner.body)).not.toContain("salePrice");
  });

  it("reports a number that is not a number, by field, in Italian", () => {
    const state = { ...filled(), outputQty: "sei", shelfLifeHours: "2,5" };
    state.lines[0]!.qty = "abc";
    const result = formToBody(state, "batch", { canEditPrice: false });
    expect(result).toEqual({
      ok: false,
      errors: {
        outputQty: "Numero non valido.",
        shelfLifeHours: "Numero non valido.",
        "lines.0.qty": "Numero non valido.",
      },
    });
  });

  it("asks for a target on every line", () => {
    const state = filled();
    state.lines.push({ target: "", qty: "1", unit: "kg", yieldFactor: "" });
    const result = formToBody(state, "batch", { canEditPrice: false });
    expect(result).toEqual({
      ok: false,
      errors: { "lines.1.target": "Scegli un ingrediente o una ricetta." },
    });
  });

  it("a blank quantity is a number problem, not a silent zero", () => {
    const state = filled();
    state.lines[0]!.qty = "";
    const result = formToBody(state, "batch", { canEditPrice: false });
    expect(result.ok).toBe(false);
  });
});

describe("lines", () => {
  it("adds a blank line and removes one by position, never emptying the list", () => {
    let state = emptyForm("sub");
    expect(state.lines).toHaveLength(1);
    state = addLine(state);
    expect(state.lines).toHaveLength(2);
    state = removeLine(removeLine(state, 0), 0);
    expect(state.lines).toHaveLength(1);
  });
});

describe("formFromDetail", () => {
  it("prefills a new version from the current one, with the decimal comma", () => {
    const detail = {
      name: "Polenta (demo)",
      type: "sub",
      outputQty: 1.5,
      outputUnit: "kg",
      portionsPerBatch: null,
      shelfLifeHours: null,
      prepTimeMin: 20,
      minPortions: null,
      targetPortions: null,
      lines: [
        {
          position: 1,
          target: { kind: "ingredient", id: ING, name: "x" },
          qty: 0.3,
          unit: "kg",
          yieldFactor: 0.82,
          warnings: [],
        },
        {
          position: 2,
          target: { kind: "recipe", id: SUB, name: "y", type: "sub" },
          qty: 1,
          unit: "kg",
          yieldFactor: 1,
          warnings: [],
        },
      ],
      pricing: { salePrice: 12.5, targetGpPct: 70 },
    } as unknown as RecipeDetail;
    const state = formFromDetail(detail);
    expect(state).toMatchObject({
      name: "Polenta (demo)",
      outputQty: "1,5",
      outputUnit: "kg",
      portionsPerBatch: "",
      prepTimeMin: "20",
      salePrice: "12,5",
      targetGpPct: "70",
    });
    expect(state.lines).toEqual([
      { target: `i:${ING}`, qty: "0,3", unit: "kg", yieldFactor: "0,82" },
      { target: `r:${SUB}`, qty: "1", unit: "kg", yieldFactor: "1" },
    ]);
  });
});

describe("formErrorsFromApi", () => {
  it("maps recipe_invalid details to the form's field keys with Italian texts", () => {
    const errors = formErrorsFromApi({
      code: "recipe_invalid",
      message: "La ricetta contiene valori non validi.",
      details: [
        { field: "lines.0.yieldFactor", code: "yield_factor_not_positive" },
        { field: "name", code: "required" },
      ],
    });
    expect(errors.fields).toEqual({
      "lines.0.yieldFactor": "La resa deve essere maggiore di 0.",
      name: "valore obbligatorio",
    });
    expect(errors.summary).toBe("La ricetta contiene valori non validi.");
  });

  it("other errors have a summary only, preferring the catalogue text", () => {
    expect(formErrorsFromApi({ code: "recipe_cycle", message: "server text" }).summary).toContain(
      "Questa sottoricetta usa già",
    );
    expect(formErrorsFromApi({ code: "internal", message: "Errore interno." })).toEqual({
      summary: "Errore interno.",
      fields: {},
    });
  });
});
