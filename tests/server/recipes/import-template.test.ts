import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS } from "@/server/master/import";
import { recipeRowsFromCsv, recipeRowsFromJson } from "@/server/recipes/import-template";

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/import/${name}`, import.meta.url), "utf8");
const jsonFixture = () =>
  (JSON.parse(fixture("ricette-demo.json")) as { recipes: object[] }).recipes;
const withoutRow = (rows: { row: number }[]) => rows.map(({ row: _row, ...rest }) => rest);

const HEADER =
  "ricetta;tipo;uscita_qty;uscita_unita;porzioni;conservazione_ore;preparazione_min;porzioni_min;porzioni_obiettivo;prezzo_vendita;gp_obiettivo;ingrediente;sottoricetta;qty;unita;resa";
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");
const SUB_ROW = "Polenta (demo);sottoricetta;1;kg;;;;;;;;Farina di mais (demo);;0,3;kg;1";

describe("CSV template (AT4 parser)", () => {
  it("parses the demo CSV to exactly the demo JSON, numbering the file line of each recipe", () => {
    const { rows, errors } = recipeRowsFromCsv(fixture("ricette-demo.csv"));
    expect(errors).toEqual([]);
    expect(withoutRow(rows)).toEqual(jsonFixture());
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4]);
  });

  it("the demo JSON is accepted as it is", () => {
    const { rows, errors } = recipeRowsFromJson(jsonFixture());
    expect(errors).toEqual([]);
    expect(withoutRow(rows)).toEqual(jsonFixture());
    expect(rows.map((r) => r.row)).toEqual([1, 2, 3]);
  });

  it("reads a decimal comma and a decimal point alike", () => {
    const a = recipeRowsFromCsv(
      csv("Salsa (demo);sottoricetta;1;l;;;;;;;;Pomodoro (demo);;0,82;kg;0,82"),
    );
    const b = recipeRowsFromCsv(
      csv("Salsa (demo);sottoricetta;1;l;;;;;;;;Pomodoro (demo);;0.82;kg;0.82"),
    );
    expect(a.errors).toEqual([]);
    expect(a.rows[0]!.lines[0]).toMatchObject({ qty: 0.82, yieldFactor: 0.82 });
    expect(b.rows).toEqual(a.rows);
  });

  it("maps the type words to types", () => {
    const rows = recipeRowsFromCsv(
      csv(
        "A;lotto;1;kg;2;24;;;;;;X;;1;kg;",
        "B;piatto;;;;;;;;;;X;;1;kg;",
        "C;sottoricetta;1;kg;;;;;;;;X;;1;kg;",
      ),
    ).rows;
    expect(rows.map((r) => r.type)).toEqual(["batch", "plate", "sub"]);
  });

  it("a later row with a different recipe-level value is recipe_fields_disagree at its file line", () => {
    const { errors } = recipeRowsFromCsv(
      csv(SUB_ROW, "Polenta (demo);sottoricetta;2;kg;;;;;;;;Sale (demo);;0,01;kg;1"),
    );
    expect(errors).toEqual([{ row: 3, field: "uscita_qty", code: "recipe_fields_disagree" }]);
  });

  it("a later row may repeat or leave blank the recipe-level cells", () => {
    const { rows, errors } = recipeRowsFromCsv(
      csv(
        SUB_ROW,
        "Polenta (demo);sottoricetta;1;kg;;;;;;;;Sale (demo);;0,01;kg;1",
        ";;;;;;;;;;;Olio (demo);;0,01;l;",
      ),
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lines).toHaveLength(3);
  });

  it("both ingrediente and sottoricetta, or neither, is line_target_required", () => {
    const both = recipeRowsFromCsv(csv("P;piatto;;;;;;;;;;X;Y;1;kg;"));
    expect(both.errors).toEqual([{ row: 2, field: "ingrediente", code: "line_target_required" }]);
    const none = recipeRowsFromCsv(csv("P;piatto;;;;;;;;;;;;1;kg;"));
    expect(none.errors).toEqual([{ row: 2, field: "ingrediente", code: "line_target_required" }]);
  });

  it("refuses formula-leading cells with invalid_value, wherever they are", () => {
    for (const cell of ["=SUM(A1)", "+1", "@cmd"]) {
      const { errors } = recipeRowsFromCsv(csv(`${cell};piatto;;;;;;;;;;X;;1;kg;`));
      expect(errors).toEqual([{ row: 2, field: "ricetta", code: "invalid_value" }]);
    }
    const inLine = recipeRowsFromCsv(csv("P;piatto;;;;;;;;;;=cmd();;1;kg;"));
    expect(inLine.errors).toEqual([{ row: 2, field: "ingrediente", code: "invalid_value" }]);
  });

  it("an unknown column is unknown_column at the header line; a missing ricetta column is missing_column", () => {
    expect(recipeRowsFromCsv(`${HEADER};extra\n`).errors).toEqual([
      { row: 1, field: "extra", code: "unknown_column" },
    ]);
    expect(recipeRowsFromCsv("tipo;qty;unita\npiatto;1;kg").errors).toContainEqual({
      row: 1,
      field: "ricetta",
      code: "missing_column",
    });
  });

  it("reports bad type, unit and numbers by field and file line", () => {
    const { errors } = recipeRowsFromCsv(
      csv(
        "A;menu;1;kg;;;;;;;;X;;1;kg;",
        "B;lotto;1;t;2;24;;;;;;X;;1;kg;",
        "C;lotto;1;kg;due;24;;;;;;X;;1;kg;",
        "D;piatto;;;;;;;;;;X;;uno;kg;",
        "E;piatto;;;;;;;;;;X;;1;etti;",
        "F;piatto;;;;;;;;;;X;;1;kg;mezzo",
      ),
    );
    expect(errors).toEqual([
      { row: 2, field: "tipo", code: "invalid_value" },
      { row: 3, field: "uscita_unita", code: "invalid_unit" },
      { row: 4, field: "porzioni", code: "invalid_number" },
      { row: 5, field: "qty", code: "invalid_number" },
      { row: 6, field: "unita", code: "invalid_unit" },
      { row: 7, field: "resa", code: "invalid_number" },
    ]);
  });

  it("requires the recipe name, the type, the quantity and the unit", () => {
    const { errors } = recipeRowsFromCsv(csv(";piatto;;;;;;;;;;X;;1;kg;", "P;;;;;;;;;;;X;;;;"));
    expect(errors).toEqual([
      { row: 2, field: "ricetta", code: "required" },
      { row: 3, field: "tipo", code: "required" },
      { row: 3, field: "qty", code: "required" },
      { row: 3, field: "unita", code: "required" },
    ]);
  });

  it("a blank price keeps the stored one (key absent); the dash clears it (null)", () => {
    const blank = recipeRowsFromCsv(csv("P;piatto;;;;;;;;;;X;;1;kg;")).rows[0]!;
    expect(blank).not.toHaveProperty("salePrice");
    expect(blank).not.toHaveProperty("targetGpPct");
    const cleared = recipeRowsFromCsv(csv("P;piatto;;;;;;;;-;-;X;;1;kg;")).rows[0]!;
    expect(cleared.salePrice).toBeNull();
    expect(cleared.targetGpPct).toBeNull();
  });

  it("the same recipe name twice, apart, is one recipe; names are compared normalised", () => {
    const { rows } = recipeRowsFromCsv(
      csv(
        "P;piatto;;;;;;;;;;X;;1;kg;",
        "Q;piatto;;;;;;;;;;X;;1;kg;",
        "  p ;piatto;;;;;;;;;;Y;;1;kg;",
      ),
    );
    expect(rows.map((r) => r.name)).toEqual(["P", "Q"]);
    expect(rows[0]!.lines).toHaveLength(2);
  });

  it("an unterminated quote is reported at its line", () => {
    expect(recipeRowsFromCsv(`${HEADER}\n"P;piatto`).errors).toEqual([
      { row: 2, field: "(file)", code: "unterminated_quote" },
    ]);
  });

  it("accepts a comma-separated file", () => {
    const comma = csv(SUB_ROW).replaceAll(";", ",").replace("0,3", '"0,3"');
    expect(recipeRowsFromCsv(comma).errors).toEqual([]);
  });

  it("more than 1 000 lines is refused as a whole file", () => {
    const many = csv(
      ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => "P;piatto;;;;;;;;;;X;;1;kg;"),
    );
    expect(() => recipeRowsFromCsv(many)).toThrowError(/1000/);
  });

  it("never echoes cell contents in an error", () => {
    const { errors } = recipeRowsFromCsv(csv("Segreto (demo);menu;;;;;;;;;;X;;1;kg;"));
    expect(JSON.stringify(errors)).not.toContain("Segreto");
  });
});

describe("JSON template", () => {
  const base = { name: "P", type: "plate", lines: [{ ingredient: "X", qty: 1, unit: "kg" }] };

  it("refuses unknown keys, at the recipe and at the line", () => {
    const { errors } = recipeRowsFromJson([
      { ...base, extra: 1 },
      { ...base, lines: [{ ingredient: "X", qty: 1, unit: "kg", price: 1 }] },
    ]);
    expect(errors).toEqual([
      { row: 1, field: "extra", code: "unknown_column" },
      { row: 2, field: "lines.0.price", code: "unknown_column" },
    ]);
  });

  it("refuses wrong types and bad values by field", () => {
    const { errors } = recipeRowsFromJson([
      { ...base, name: 5 },
      { ...base, type: "menu" },
      { ...base, outputQty: "6" },
      { ...base, lines: "x" },
      { ...base, lines: [{ ingredient: "X", recipe: "Y", qty: 1, unit: "kg" }] },
      { ...base, lines: [{ ingredient: "X", qty: "1", unit: "kg" }] },
      { ...base, lines: [{ ingredient: "X", qty: 1, unit: "t" }] },
      "text",
    ]);
    expect(errors).toEqual([
      { row: 1, field: "name", code: "required" },
      { row: 2, field: "type", code: "invalid_value" },
      { row: 3, field: "outputQty", code: "invalid_number" },
      { row: 4, field: "lines", code: "invalid_value" },
      { row: 5, field: "lines.0", code: "line_target_required" },
      { row: 6, field: "lines.0.qty", code: "invalid_number" },
      { row: 7, field: "lines.0.unit", code: "invalid_unit" },
      { row: 8, field: "(row)", code: "invalid_value" },
    ]);
  });

  it("refuses a formula-leading name", () => {
    expect(recipeRowsFromJson([{ ...base, name: "=1+1" }]).errors).toEqual([
      { row: 1, field: "name", code: "invalid_value" },
    ]);
  });

  it("keeps a null price as the clear mark and an absent price as absent", () => {
    const rows = recipeRowsFromJson([{ ...base, salePrice: null }, base]).rows;
    expect(rows[0]!.salePrice).toBeNull();
    expect(rows[1]).not.toHaveProperty("salePrice");
  });

  it("a name repeated in the file is duplicate_in_file", () => {
    expect(recipeRowsFromJson([base, base]).errors).toEqual([
      { row: 2, field: "name", code: "duplicate_in_file" },
    ]);
  });
});
