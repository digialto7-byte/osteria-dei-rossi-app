import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionEnv } from "@/lib/env";
import { createExtractionClient } from "@/server/extraction/client";
import { MAX_EXTRACTION_ATTEMPTS } from "@/server/extraction/constants";
import { fakeAnthropicFetch } from "../../helpers/fake-anthropic-fetch";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";
import { fakePdf } from "../../helpers/fake-files";
import { buildSignedData } from "../../fixtures/fatturapa/build-cms";
import { bytesOf, fileXml } from "../../fixtures/fatturapa/build-xml";

const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
const { runExtractionJob } = await import("@/server/cron/extract-job");

const TENANT = "11111111-1111-4111-8111-111111111111";
const INVOICE = "1b000000-0000-4000-8000-0000000000b1";
const TOKEN = "70000000-0000-4000-8000-000000000001";
const ENV: ExtractionEnv = {
  anthropicApiKey: "test-key",
  modelId: "test-model-from-env",
  effort: "medium",
};
const ok = (data: unknown): FakeResult => ({ data, error: null });
const blob = (bytes: Uint8Array) => ({ data: new Blob([bytes as BlobPart]), error: null });

function setup(row: Record<string, unknown>, download = blob(fakePdf())) {
  const admin = fakeSupabase({
    rpc: {
      extraction_claim: [
        ok([{ id: INVOICE, tenant_id: TENANT, claim_token: TOKEN, attempts: 1, ...row }]),
      ],
      extraction_fail: [ok("extraction_failed")],
      extraction_complete: [ok("review")],
    },
    storage: { download: [download] },
    results: { tenant: [ok({ vat_number: "IT00000000000" })] },
  });
  const fake = fakeAnthropicFetch([{ fixture: "valid" }]);
  const makeClient = vi.fn((env: ExtractionEnv) =>
    createExtractionClient(env, fake.fetchImpl as typeof fetch),
  );
  const run = () =>
    runExtractionJob({
      admin: admin as unknown as SupabaseClient,
      makeClient,
      readEnv: () => ENV,
      now: () => 0,
    });
  const failArgs = () =>
    admin.rpc.mock.calls
      .filter(([name]) => name === "extraction_fail")
      .map(([, args]) => args as Record<string, unknown>);
  return { admin, fake, makeClient, run, failArgs };
}

beforeEach(() => {
  reportError.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the extraction worker never reads an e-invoice file", () => {
  it.each([
    ["application/xml", "xml"],
    ["application/pkcs7-mime", "p7m"],
  ])(
    "a claimed %s row fails as file_mismatch, not retryable, with no download and no model call",
    async (mime, ext) => {
      const { run, admin, makeClient, fake, failArgs } = setup({
        file_mime: mime,
        file_path: `${TENANT}/1998/${INVOICE}.${ext}`,
      });
      expect(await run()).toEqual({ claimed: INVOICE, status: "extraction_failed" });
      expect(failArgs()).toEqual([
        expect.objectContaining({
          p_invoice: INVOICE,
          p_claim_token: TOKEN,
          p_code: "file_mismatch",
          p_retryable: false,
          p_max_attempts: MAX_EXTRACTION_ATTEMPTS,
        }),
      ]);
      expect(admin.storage.download).not.toHaveBeenCalled();
      expect(makeClient).not.toHaveBeenCalled();
      expect(fake.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an XML file", bytesOf(fileXml()), "application/pdf", "pdf"],
    ["a p7m file", buildSignedData({ content: bytesOf(fileXml()) }), "application/pdf", "pdf"],
  ])(
    "%s stored under a PDF row fails as file_mismatch without a model call",
    async (_name, bytes, mime, ext) => {
      const { run, makeClient, fake, failArgs } = setup(
        { file_mime: mime, file_path: `${TENANT}/1998/${INVOICE}.${ext}` },
        blob(bytes),
      );
      await run();
      expect(failArgs()[0]).toMatchObject({ p_code: "file_mismatch", p_retryable: false });
      expect(makeClient).not.toHaveBeenCalled();
      expect(fake.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("still reads a PDF row", async () => {
    const { run, makeClient } = setup({
      file_mime: "application/pdf",
      file_path: `${TENANT}/1998/${INVOICE}.pdf`,
    });
    expect(await run()).toEqual({ claimed: INVOICE, status: "review" });
    expect(makeClient).toHaveBeenCalledOnce();
  });
});
