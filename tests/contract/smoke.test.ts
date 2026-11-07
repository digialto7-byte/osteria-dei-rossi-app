import { describe, expect, it } from "vitest";
import type { ExtractionOutcome } from "@/server/extraction/extract";
import { MAX_MODEL_CALL_MS } from "./compare";
import { SMOKE_REQUIRED_ENV, renderSmokeNotice, smokePreflight, smokeVerdict } from "./smoke";

const ENV = { ANTHROPIC_API_KEY: "test-key", EXTRACTION_MODEL_ID: "test-model" };

const valid = {
  supplier_name: null,
  supplier_vat: null,
  invoice_number: null,
  invoice_date: null,
  due_date: null,
  payment_terms: null,
  net_total: null,
  vat_total: null,
  gross_total: null,
  lines: [],
  confidence: {
    supplier_name: 0,
    supplier_vat: 0,
    invoice_number: 0,
    invoice_date: 0,
    due_date: 0,
    payment_terms: 0,
    net_total: 0,
    vat_total: 0,
    gross_total: 0,
  },
};

describe("smoke preflight", () => {
  it("runs when both secrets are present", () => {
    expect(smokePreflight(ENV)).toEqual({ ready: true, missing: [] });
  });

  it("skips and names what is missing, treating blank as missing", () => {
    expect(smokePreflight({ ANTHROPIC_API_KEY: " ", EXTRACTION_MODEL_ID: undefined })).toEqual({
      ready: false,
      missing: ["ANTHROPIC_API_KEY", "EXTRACTION_MODEL_ID"],
    });
    expect(smokePreflight({ ANTHROPIC_API_KEY: "k", EXTRACTION_MODEL_ID: "" }).missing).toEqual([
      "EXTRACTION_MODEL_ID",
    ]);
  });

  it("does not ask for invoice pairs", () => {
    expect(SMOKE_REQUIRED_ENV).toEqual(["ANTHROPIC_API_KEY", "EXTRACTION_MODEL_ID"]);
  });

  it("renders a ::notice with names only, never values", () => {
    const notice = renderSmokeNotice(smokePreflight({ ...ENV, EXTRACTION_MODEL_ID: "" }));
    expect(notice).toBe("::notice title=Smoke contract skipped::EXTRACTION_MODEL_ID");
    expect(notice).not.toContain(ENV.ANTHROPIC_API_KEY);
  });
});

describe("smoke verdict", () => {
  const success = (data: unknown, durationMs = 1200): ExtractionOutcome =>
    ({
      ok: true,
      result: { data, extractionJson: data },
      durationMs,
      requestId: null,
    }) as unknown as ExtractionOutcome;
  const failure = (code: string): ExtractionOutcome =>
    ({
      ok: false,
      code,
      retryable: false,
      release: false,
      durationMs: 100,
      requestId: null,
    }) as unknown as ExtractionOutcome;

  it("passes on a schema-valid answer with nulls and no lines", () => {
    expect(smokeVerdict(success(valid))).toEqual({ ok: true, problems: [] });
  });

  it("fails with the code when the API rejected the request", () => {
    expect(smokeVerdict(failure("provider_rejected"))).toEqual({
      ok: false,
      problems: ["extraction failed: provider_rejected"],
    });
  });

  it("fails when the data does not fit the full schema, without printing values", () => {
    const verdict = smokeVerdict(success({ ...valid, supplier_name: "", extra: "SECRET-VALUE" }));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("schema");
    expect(verdict.problems.join(" ")).not.toContain("SECRET-VALUE");
  });

  it("fails at the time limit and passes just under it", () => {
    expect(smokeVerdict(success(valid, MAX_MODEL_CALL_MS - 1)).ok).toBe(true);
    const slow = smokeVerdict(success(valid, MAX_MODEL_CALL_MS));
    expect(slow.ok).toBe(false);
    expect(slow.problems[0]).toContain("60000");
  });

  it("reports every problem at once", () => {
    const verdict = smokeVerdict(success({}, MAX_MODEL_CALL_MS + 5));
    expect(verdict.problems).toHaveLength(2);
  });
});
