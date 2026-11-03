import { describe, expect, it } from "vitest";
import { classifyResponse } from "@/server/extraction/outcome";
import { InvoiceExtraction, toWireSchema, WIRE_ALLOWED_KEYS } from "@/server/extraction/schema";
import { validExtraction } from "../../helpers/extraction-data";

// Guards on the JSON schema sent to the Messages API. A 400 from the API (provider_rejected) is
// otherwise only seen on staging with a real invoice.

type Node = Record<string, unknown>;

/** Visits every schema node. The keys of a `properties` map are field names, not keywords. */
function walkNodes(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walkNodes(n, visit));
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Node;
  visit(obj);
  for (const [key, value] of Object.entries(obj)) {
    if (key === "properties" || key === "$defs") {
      Object.values(value as Node).forEach((n) => walkNodes(n, visit));
    } else {
      walkNodes(value, visit);
    }
  }
}

const ALLOWED = new Set<string>([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "format",
  "description",
  "enum",
  "const",
]);
const FORBIDDEN = [
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
];
const MAX_ANY_OF = 15;
const MAX_OPTIONAL = 24;

const keysOutsideAllowlist = (schema: unknown): string[] => {
  const found = new Set<string>();
  walkNodes(schema, (n) => Object.keys(n).forEach((k) => ALLOWED.has(k) || found.add(k)));
  return [...found].sort();
};
const countAnyOf = (schema: unknown): number => {
  let count = 0;
  walkNodes(schema, (n) => {
    if ("anyOf" in n) count++;
  });
  return count;
};
const countOptional = (schema: unknown): number => {
  let count = 0;
  walkNodes(schema, (n) => {
    if (n.properties && typeof n.properties === "object") {
      const required = new Set((n.required as string[] | undefined) ?? []);
      count += Object.keys(n.properties).filter((k) => !required.has(k)).length;
    }
  });
  return count;
};
const openObjects = (schema: unknown): number => {
  let count = 0;
  walkNodes(schema, (n) => {
    if (n.type === "object" && n.additionalProperties !== false) count++;
  });
  return count;
};
const forbiddenKeys = (schema: unknown): string[] => {
  const found = new Set<string>();
  walkNodes(schema, (n) => FORBIDDEN.forEach((k) => k in n && found.add(k)));
  return [...found].sort();
};

describe("wire schema guards on toWireSchema()", () => {
  const wire = toWireSchema();

  it("(a) uses only allowlisted keywords", () => {
    expect(keysOutsideAllowlist(wire)).toEqual([]);
  });

  it("(a) the exported allowlist is the one asserted here", () => {
    expect([...WIRE_ALLOWED_KEYS].sort()).toEqual([...ALLOWED].sort());
  });

  it("(b) stays under the API cap of 16 union-typed parameters", () => {
    const count = countAnyOf(wire);
    expect(
      count,
      `the API caps union-typed parameters at 16 per request and this schema has ${count} (anyOf, nullables included); at 15 it is one away`,
    ).toBeLessThanOrEqual(MAX_ANY_OF);
  });

  it("(c) has at most 24 optional properties", () => {
    expect(countOptional(wire)).toBeLessThanOrEqual(MAX_OPTIONAL);
  });

  it("(d) closes every object", () => {
    expect(openObjects(wire)).toBe(0);
  });

  it("(e) holds no pattern or numeric/length/array constraint", () => {
    expect(forbiddenKeys(wire)).toEqual([]);
  });

  it("keeps format: date and the nullable unions", () => {
    const text = JSON.stringify(wire);
    expect(text).toContain('"format":"date"');
    expect(text).not.toContain("pattern");
  });
});

describe("guard self-tests (each catches a bad node)", () => {
  it("(a) flags a key outside the allowlist, nested, but not field names in properties", () => {
    const bad = { type: "object", properties: { pattern: { type: "string", title: "x" } } };
    expect(keysOutsideAllowlist(bad)).toEqual(["title"]);
    expect(
      keysOutsideAllowlist({ type: "object", properties: { pattern: { type: "string" } } }),
    ).toEqual([]);
    expect(keysOutsideAllowlist({ anyOf: [{ type: "string", $ref: "#" }] })).toEqual(["$ref"]);
  });

  it("(b) counts anyOf nodes and fails at 16", () => {
    const make = (n: number) => ({
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: n }, (_, i) => [
          `f${i}`,
          { anyOf: [{ type: "string" }, { type: "null" }] },
        ]),
      ),
    });
    expect(countAnyOf(make(15))).toBe(15);
    expect(countAnyOf(make(16))).toBe(16);
    expect(countAnyOf(make(16))).toBeGreaterThan(MAX_ANY_OF);
    expect(countAnyOf(make(15))).not.toBeGreaterThan(MAX_ANY_OF);
  });

  it("(c) counts properties missing from required, per object", () => {
    const bad = {
      type: "object",
      required: ["a"],
      properties: {
        a: { type: "string" },
        b: { type: "string" },
        c: { type: "object", properties: { d: {} } },
      },
    };
    expect(countOptional(bad)).toBe(3); // b, c, and d (no required array)
    expect(countOptional({ type: "object", required: ["a"], properties: { a: {} } })).toBe(0);
  });

  it("(d) flags an object without additionalProperties: false", () => {
    expect(
      openObjects({
        type: "object",
        properties: { a: { type: "object", additionalProperties: false } },
      }),
    ).toBe(1);
    expect(openObjects({ type: "object", additionalProperties: true })).toBe(1);
    expect(openObjects({ type: "object", additionalProperties: false })).toBe(0);
  });

  it("(e) flags pattern and constraints, also inside items and anyOf", () => {
    expect(
      forbiddenKeys({ type: "array", items: { type: "string", pattern: "^a$" }, maxItems: 3 }),
    ).toEqual(["maxItems", "pattern"]);
    expect(forbiddenKeys({ anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] })).toEqual([
      "minimum",
    ]);
    expect(forbiddenKeys({ type: "string", format: "date" })).toEqual([]);
  });
});

describe("constraints dropped from the wire are still enforced after the call", () => {
  const parse = (value: unknown) => InvoiceExtraction.safeParse(value);

  it("accepts the valid fixture", () => {
    expect(parse(validExtraction()).success).toBe(true);
  });

  it("rejects a too-long string", () => {
    expect(parse({ ...validExtraction(), invoice_number: "x".repeat(65) }).success).toBe(false);
  });

  it.each(["2026-02-30", "31/10/2026", "2026-13-01", "not a date"])(
    "rejects a bad date %j",
    (date) => {
      expect(parse({ ...validExtraction(), invoice_date: date }).success).toBe(false);
      const data = validExtraction();
      Object.assign(data.lines[0], { expiry: date });
      expect(parse(data).success).toBe(false);
    },
  );

  it("rejects an out-of-range number", () => {
    const data = validExtraction();
    data.confidence.gross_total = 1.5;
    expect(parse(data).success).toBe(false);
  });
});

describe("the response path validates with the full Zod schema", () => {
  const reply = (value: unknown) =>
    classifyResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    });

  it("passes a valid reply", () => {
    expect(reply(validExtraction()).ok).toBe(true);
  });

  it("fails a reply with a bad date, a pattern the wire no longer carries", () => {
    expect(reply({ ...validExtraction(), invoice_date: "2026-02-30" })).toMatchObject({
      ok: false,
      code: "schema_invalid",
    });
  });

  it("fails a reply with a too-long string, a maxLength the wire no longer carries", () => {
    expect(reply({ ...validExtraction(), supplier_name: "x".repeat(201) })).toMatchObject({
      ok: false,
      code: "schema_invalid",
    });
  });
});
