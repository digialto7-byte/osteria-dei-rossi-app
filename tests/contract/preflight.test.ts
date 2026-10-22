import { describe, expect, it } from "vitest";
import { MIN_CONTRACT_INVOICES, listPairs, preflight, renderPreflightNotice } from "./preflight";

const ENV = { ANTHROPIC_API_KEY: "sk-test-fake-value", EXTRACTION_MODEL_ID: "test-model-value" };
const pairNames = (count: number, ext = "pdf") =>
  Array.from({ length: count }, (_, i) => [
    `fattura-${i + 1}.${ext}`,
    `fattura-${i + 1}.expected.json`,
  ]).flat();

describe("contract preflight", () => {
  it("an empty folder is not ready and says how many invoices were found", () => {
    expect(preflight({ files: [], env: ENV })).toEqual({
      ready: false,
      missing: ["10 invoices (found 0)"],
    });
  });

  it("10 pairs and both env names -> ready", () => {
    expect(preflight({ files: pairNames(10), env: ENV })).toEqual({ ready: true, missing: [] });
  });

  it("accepts pdf, jpg and png documents", () => {
    const files = [
      ...pairNames(4, "pdf"),
      ...pairNames(3, "jpg").map(rename("b")),
      ...pairNames(3, "png").map(rename("c")),
    ];
    expect(listPairs(files)).toHaveLength(10);
    expect(preflight({ files, env: ENV }).ready).toBe(true);
  });

  it("a document without its .expected.json is not counted", () => {
    const files = [...pairNames(9), "fattura-10.pdf"];
    expect(preflight({ files, env: ENV })).toEqual({
      ready: false,
      missing: ["10 invoices (found 9)"],
    });
  });

  it("an .expected.json without a document is not counted", () => {
    const files = [...pairNames(9), "fattura-10.expected.json"];
    expect(preflight({ files, env: ENV }).missing).toEqual(["10 invoices (found 9)"]);
  });

  it("ignores files whose names do not follow the naming rule", () => {
    const files = [
      ...pairNames(9),
      "Fattura Rossi.pdf",
      "Fattura Rossi.expected.json",
      "x.exe",
      "../y.pdf",
    ];
    expect(listPairs(files)).toHaveLength(9);
  });

  it("a stem with two document formats is one invoice", () => {
    const files = ["a.pdf", "a.png", "a.expected.json"];
    expect(listPairs(files).map((pair) => pair.stem)).toEqual(["a"]);
  });

  it("names each missing env variable, and treats blank as missing", () => {
    expect(
      preflight({
        files: pairNames(10),
        env: { ANTHROPIC_API_KEY: "  ", EXTRACTION_MODEL_ID: "" },
      }),
    ).toEqual({ ready: false, missing: ["ANTHROPIC_API_KEY", "EXTRACTION_MODEL_ID"] });
    expect(
      preflight({
        files: pairNames(10),
        env: { ANTHROPIC_API_KEY: "k", EXTRACTION_MODEL_ID: undefined },
      }).missing,
    ).toEqual(["EXTRACTION_MODEL_ID"]);
  });

  it("lists everything that is missing at once", () => {
    expect(preflight({ files: [], env: {} }).missing).toEqual([
      "ANTHROPIC_API_KEY",
      "EXTRACTION_MODEL_ID",
      "10 invoices (found 0)",
    ]);
    expect(MIN_CONTRACT_INVOICES).toBe(10);
  });

  it("never puts an env value in its result or in the notice", () => {
    const result = preflight({ files: [], env: ENV });
    const output = JSON.stringify(result) + renderPreflightNotice(result);
    expect(output).not.toContain(ENV.ANTHROPIC_API_KEY);
    expect(output).not.toContain(ENV.EXTRACTION_MODEL_ID);
  });

  it("renders the skip notice as a GitHub ::notice with the missing names", () => {
    const text = renderPreflightNotice({
      ready: false,
      missing: ["ANTHROPIC_API_KEY", "10 invoices (found 3)"],
    });
    expect(text).toBe(
      "::notice title=Contract run skipped::ANTHROPIC_API_KEY, 10 invoices (found 3)",
    );
  });
});

/** Gives a set of pair names a different stem prefix, so several formats do not collide. */
function rename(prefix: string) {
  return (name: string) => `${prefix}-${name}`;
}
