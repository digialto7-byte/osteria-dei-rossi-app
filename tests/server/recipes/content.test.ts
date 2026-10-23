import { describe, expect, it } from "vitest";
import { canonicalTemplate, contentOf, toRpcRow } from "@/server/recipes/content";

const ING = "1a000000-0000-4000-8000-00000000001a";

describe("contentOf", () => {
  it("keeps the content keys and drops type and baseVersion", () => {
    const body = {
      type: "batch" as const,
      baseVersion: 2,
      name: "Spezzatino (demo)",
      outputQty: 6,
      lines: [{ ingredientId: ING, qty: 5, unit: "kg" as const }],
    };
    const content = contentOf(body);
    expect(content).not.toHaveProperty("type");
    expect(content).not.toHaveProperty("baseVersion");
    expect(content.name).toBe("Spezzatino (demo)");
    expect(content.lines).toEqual(body.lines);
  });

  it("leaves an absent price key absent and a null one null, so the procedure can tell keep from clear", () => {
    const absent = JSON.parse(
      JSON.stringify(contentOf({ name: "A", lines: [{ ingredientId: ING, qty: 1, unit: "kg" }] })),
    );
    expect(absent).not.toHaveProperty("salePrice");
    const cleared = JSON.parse(
      JSON.stringify(contentOf({ name: "A", salePrice: null, lines: [] })),
    );
    expect(cleared.salePrice).toBeNull();
  });
});

describe("canonicalTemplate", () => {
  it("is the same for the same recipe however the keys were ordered or left undefined", () => {
    const a = canonicalTemplate({
      name: "P",
      type: "plate",
      salePrice: 12,
      outputQty: undefined,
      lines: [{ qty: 1, unit: "pz", ingredient: "Pane (demo)", yieldFactor: undefined }],
    });
    const b = canonicalTemplate({
      lines: [{ ingredient: "Pane (demo)", unit: "pz", qty: 1 }],
      type: "plate",
      name: "P",
      salePrice: 12,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).not.toHaveProperty("outputQty");
  });

  it("keeps null prices (the clear mark) and the order of the lines", () => {
    const c = canonicalTemplate({
      name: "P",
      type: "plate",
      salePrice: null,
      lines: [
        { recipe: "B", qty: 1, unit: "porz" },
        { ingredient: "A", qty: 2, unit: "kg" },
      ],
    });
    expect(c.salePrice).toBeNull();
    expect(c.lines.map((l) => l.recipe ?? l.ingredient)).toEqual(["B", "A"]);
  });
});

describe("toRpcRow", () => {
  it("is the canonical recipe plus its file row", () => {
    expect(
      toRpcRow({
        row: 4,
        name: "P",
        type: "plate",
        lines: [{ ingredient: "A", qty: 1, unit: "kg" }],
      }),
    ).toEqual({
      row: 4,
      name: "P",
      type: "plate",
      lines: [{ ingredient: "A", qty: 1, unit: "kg" }],
    });
  });
});
