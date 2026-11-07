import { describe, expect, it } from "vitest";
import { readExtractionEnv } from "@/lib/env";
import { createExtractionClient } from "@/server/extraction/client";
import { extractInvoice } from "@/server/extraction/extract";
import { fakeInvoicePdf } from "../helpers/fake-files";
import { smokeVerdict } from "./smoke";

// One real request through the production path (extractInvoice -> requestExtraction ->
// toWireSchema), with a synthetic one-page PDF. It catches a request the API rejects (HTTP 400)
// without needing the 10 invoice pairs. Fails closed (ConfigError) when the variables are missing.
// It asserts no extracted value: a synthetic invoice may legitimately yield nulls.
describe("extraction smoke contract", () => {
  it("is answered 200, schema-valid, in under 60 s", async () => {
    const env = readExtractionEnv();
    const outcome = await extractInvoice(
      { bytes: fakeInvoicePdf(), kind: "pdf" },
      {
        client: createExtractionClient(env),
        modelId: env.modelId,
        effort: env.effort,
        now: Date.now,
      },
    );
    // Codes and timings only: never the content.
    const verdict = smokeVerdict(outcome);
    expect(verdict.problems).toEqual([]);
  });
});
