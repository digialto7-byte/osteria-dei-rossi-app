import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { readExtractionEnv } from "@/lib/env";
import { createExtractionClient } from "@/server/extraction/client";
import { extractInvoice, type ExtractionOutcome } from "@/server/extraction/extract";
import { fakeInjectionPdf } from "../helpers/fake-files";
import {
  MAX_MODEL_CALL_MS,
  compareInvoice,
  parseExpected,
  renderSummary,
  summarise,
  type InvoiceResult,
} from "./compare";
import { MIN_CONTRACT_INVOICES, listPairs } from "./preflight";

// Live contract run (acceptance test 8 and the live side of 4). Calls the real API with the
// model from EXTRACTION_MODEL_ID; fails closed (ConfigError) when the two variables are missing.
const env = readExtractionEnv();
const client = createExtractionClient(env);
const folder = fileURLToPath(new URL("./invoices/", import.meta.url));

const KIND: Record<string, "pdf" | "jpg" | "png"> = { ".pdf": "pdf", ".jpg": "jpg", ".png": "png" };

// Logs carry codes and timings only (the default logger of extractInvoice); nothing else prints.
const call = (bytes: Uint8Array, kind: "pdf" | "jpg" | "png"): Promise<ExtractionOutcome> =>
  extractInvoice({ bytes, kind }, { client, modelId: env.modelId, now: Date.now });

const results: InvoiceResult[] = [];

describe("live extraction contract", () => {
  const files = (() => {
    try {
      return readdirSync(folder);
    } catch {
      return [];
    }
  })();
  const pairs = listPairs(files);

  it(`has at least ${MIN_CONTRACT_INVOICES} invoice pairs`, () => {
    expect(pairs.length).toBeGreaterThanOrEqual(MIN_CONTRACT_INVOICES);
  });

  describe.each(pairs.map((pair) => [pair.stem, pair] as const))("%s", (stem, pair) => {
    it(`extracts within ${MAX_MODEL_CALL_MS / 1000} s and is compared with the expected file`, async () => {
      const expected = parseExpected(JSON.parse(readFileSync(join(folder, pair.expected), "utf8")));
      const bytes = new Uint8Array(readFileSync(join(folder, pair.document)));
      const outcome = await call(bytes, KIND[extname(pair.document)]!);
      results.push({
        name: stem,
        ok: outcome.ok,
        durationMs: outcome.durationMs,
        fields: outcome.ok ? compareInvoice(expected, outcome.result.data) : [],
      });
      // Only the code on failure: never the content.
      expect(outcome.ok ? "ok" : outcome.code).toBe("ok");
      expect(outcome.durationMs).toBeLessThan(MAX_MODEL_CALL_MS);
    });
  });

  it("keeps the printed prices of the synthetic injection document", async () => {
    const outcome = await call(fakeInjectionPdf(), "pdf");
    expect(outcome.ok ? "ok" : outcome.code).toBe("ok");
    if (!outcome.ok) return;
    const { data } = outcome.result;
    expect(data.lines.map((line) => line.unit_price)).toEqual([12.5, 8]);
    expect(data.gross_total).toBe(22.55);
    expect(outcome.durationMs).toBeLessThan(MAX_MODEL_CALL_MS);
  });

  afterAll(() => {
    const summary = summarise(results);
    const text = renderSummary(summary);
    const target = process.env.GITHUB_STEP_SUMMARY;
    if (target) appendFileSync(target, `${text}\n`);
    else console.warn(text);
  });
});
