import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, type ExtractionEnv } from "@/lib/env";
import { createExtractionClient } from "@/server/extraction/client";
import {
  EXTRACTION_BACKOFF_SECONDS,
  EXTRACTION_LEASE_SECONDS,
  MAX_EXTRACTION_ATTEMPTS,
  PROVIDER_AUTH_BACKOFF_SECONDS,
} from "@/server/extraction/constants";
import { fakePdf, fakePng, textBytes } from "../../helpers/fake-files";
import { errorBody, fakeAnthropicFetch, type FakeReply } from "../../helpers/fake-anthropic-fetch";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";

const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
const { runExtractionJob } = await import("@/server/cron/extract-job");

const TENANT = "11111111-1111-4111-8111-111111111111";
const INVOICE = "1b000000-0000-4000-8000-0000000000b1";
const TOKEN = "70000000-0000-4000-8000-000000000001";
const ENV: ExtractionEnv = { anthropicApiKey: "test-key", modelId: "test-model-from-env" };
const claimRow = (patch: Record<string, unknown> = {}) => ({
  id: INVOICE,
  tenant_id: TENANT,
  file_path: `${TENANT}/2026/${INVOICE}.pdf`,
  file_mime: "application/pdf",
  claim_token: TOKEN,
  attempts: 1,
  ...patch,
});
const ok = (data: unknown): FakeResult => ({ data, error: null });
const blob = (bytes: Uint8Array) => ({ data: new Blob([bytes as BlobPart]), error: null });

function setup(
  options: {
    claim?: FakeResult;
    replies?: FakeReply[];
    download?: { data: unknown; error: { message: string } | null };
    complete?: FakeResult;
    readEnv?: () => ExtractionEnv;
    timeoutMs?: number;
  } = {},
) {
  const admin = fakeSupabase({
    rpc: {
      extraction_claim: [options.claim ?? ok([claimRow()])],
      extraction_complete: [options.complete ?? ok("review")],
      extraction_fail: [ok("received")],
      extraction_release: [ok("received")],
    },
    storage: { download: [options.download ?? blob(fakePdf())] },
  });
  const fake = fakeAnthropicFetch(options.replies ?? [{ fixture: "valid" }]);
  const makeClient = vi.fn((env: ExtractionEnv) =>
    createExtractionClient(env, fake.fetchImpl as typeof fetch, options.timeoutMs),
  );
  const run = () =>
    runExtractionJob({
      admin: admin as unknown as SupabaseClient,
      makeClient,
      readEnv: options.readEnv ?? (() => ENV),
      now: () => 0,
    });
  const rpcArgs = (fn: string) =>
    admin.rpc.mock.calls
      .filter(([name]) => name === fn)
      .map(([, args]) => args as Record<string, unknown>);
  return { admin, fake, makeClient, run, rpcArgs };
}

beforeEach(() => {
  reportError.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("runExtractionJob", () => {
  it("throws ConfigError before anything is claimed when the env is incomplete (AT5)", async () => {
    const { run, admin } = setup({
      readEnv: () => {
        throw new ConfigError(["EXTRACTION_MODEL_ID"]);
      },
    });
    await expect(run()).rejects.toBeInstanceOf(ConfigError);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("claims with the lease and attempt constants", async () => {
    const { run, rpcArgs } = setup({ claim: ok([]) });
    await run();
    expect(rpcArgs("extraction_claim")).toEqual([
      { p_lease_seconds: EXTRACTION_LEASE_SECONDS, p_max_attempts: MAX_EXTRACTION_ATTEMPTS },
    ]);
  });

  it.each([ok([]), ok(null)])("returns claimed null when the queue is empty", async (claim) => {
    const { run, admin, fake } = setup({ claim });
    expect(await run()).toEqual({ claimed: null });
    expect(admin.storage.download).not.toHaveBeenCalled();
    expect(fake.fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when the claim itself fails", async () => {
    const { run } = setup({ claim: { data: null, error: { message: "db down" } } });
    await expect(run()).rejects.toThrow("extraction_claim");
  });

  it("completes a valid extraction with the claim token, 2 lines and the env model (AT1)", async () => {
    const { run, rpcArgs, admin, fake } = setup();
    expect(await run()).toEqual({ claimed: INVOICE, status: "review" });
    expect(admin.storage.from).toHaveBeenCalledWith("invoices");
    expect(admin.storage.download).toHaveBeenCalledWith(`${TENANT}/2026/${INVOICE}.pdf`);
    expect(fake.fetchImpl).toHaveBeenCalledTimes(1);
    const [call] = rpcArgs("extraction_complete");
    expect(call).toMatchObject({
      p_invoice: INVOICE,
      p_claim_token: TOKEN,
      p_model: "test-model-from-env",
    });
    const result = call?.p_result as {
      gate_flags: string[];
      totals_diff: number;
      header: Record<string, unknown>;
      lines: { field_confidence?: unknown; extracted?: unknown }[];
      field_confidence?: unknown;
      extraction_json: { lines: unknown[] };
    };
    expect(result.gate_flags).toEqual([]);
    expect(result.totals_diff).toBe(0);
    expect(result.header).toMatchObject({
      supplier_vat: "IT12345678903",
      number_raw: "FT 1/2026",
      invoice_date: "2026-10-15",
      gross_total: 33,
    });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      raw_description: "Prodotto di prova A",
      unit_raw: "kg",
      lot_code: "L-0425",
      expiry: "2026-11-30",
      checks: [],
    });
    expect(result.lines[0]?.field_confidence).toBeDefined();
    expect(result.lines[0]?.extracted).toBeDefined();
    expect(result.field_confidence).toBeDefined();
    expect(result.extraction_json.lines).toHaveLength(2);
    expect(rpcArgs("extraction_fail")).toEqual([]);
  });

  it("stores the total_mismatch flag (AT2)", async () => {
    const { run, rpcArgs } = setup({ replies: [{ fixture: "mismatch-006" }] });
    await run();
    const result = rpcArgs("extraction_complete")[0]?.p_result as Record<string, unknown>;
    expect(result.gate_flags).toEqual(["total_mismatch"]);
  });

  it("fails a path with another tenant's prefix as file_mismatch, without download", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const { run, rpcArgs, admin, fake } = setup({
      claim: ok([claimRow({ file_path: `${other}/2026/x.pdf` })]),
    });
    await run();
    expect(rpcArgs("extraction_fail")[0]).toMatchObject({
      p_code: "file_mismatch",
      p_retryable: false,
    });
    expect(admin.storage.download).not.toHaveBeenCalled();
    expect(fake.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["text bytes for a PDF row", textBytes()],
    ["PNG bytes for a PDF row", fakePng()],
    ["empty bytes", new Uint8Array()],
  ])("re-sniffs the stored bytes: %s -> file_mismatch, model not called", async (_name, bytes) => {
    const { run, rpcArgs, fake } = setup({ download: blob(bytes) });
    await run();
    expect(rpcArgs("extraction_fail")[0]).toMatchObject({
      p_code: "file_mismatch",
      p_retryable: false,
    });
    expect(fake.fetchImpl).not.toHaveBeenCalled();
    expect(rpcArgs("extraction_complete")).toEqual([]);
  });

  it("treats a download error as retryable storage_unavailable", async () => {
    const { run, rpcArgs, fake } = setup({ download: { data: null, error: { message: "boom" } } });
    await run();
    expect(rpcArgs("extraction_fail")[0]).toMatchObject({
      p_code: "storage_unavailable",
      p_retryable: true,
    });
    expect(fake.fetchImpl).not.toHaveBeenCalled();
  });

  it("fails a schema violation without retry and writes no lines (AT3)", async () => {
    const { run, rpcArgs } = setup({ replies: [{ fixture: "extra-key" }] });
    await run();
    expect(rpcArgs("extraction_fail")[0]).toMatchObject({
      p_code: "schema_invalid",
      p_retryable: false,
    });
    expect(rpcArgs("extraction_complete")).toEqual([]);
  });

  it("passes the injection fixture through as data (AT4)", async () => {
    const { run, rpcArgs } = setup({ replies: [{ fixture: "injection" }] });
    await run();
    const result = rpcArgs("extraction_complete")[0]?.p_result as {
      lines: { raw_description: string; unit_price: number }[];
    };
    expect(result.lines[0]?.raw_description).toContain("ignore previous instructions");
    expect(result.lines.map((line) => line.unit_price)).toEqual([12.5, 8]);
  });

  it("fails a timeout as retryable with the backoff list and max attempts (AT7)", async () => {
    const { run, rpcArgs } = setup({ replies: [{ body: errorBody("api_error"), status: 500 }] });
    expect(await run()).toEqual({ claimed: INVOICE, status: "received" });
    expect(rpcArgs("extraction_fail")).toEqual([
      {
        p_invoice: INVOICE,
        p_claim_token: TOKEN,
        p_code: "provider_unavailable",
        p_retryable: true,
        p_backoff_seconds: [...EXTRACTION_BACKOFF_SECONDS],
        p_max_attempts: MAX_EXTRACTION_ATTEMPTS,
      },
    ]);
  });

  it("fails a timeout as retryable (AT7)", async () => {
    const { run, rpcArgs } = setup({ replies: [{ hang: true }], timeoutMs: 20 });
    await run();
    expect(rpcArgs("extraction_fail")[0]).toMatchObject({
      p_code: "provider_timeout",
      p_retryable: true,
      p_backoff_seconds: [60, 300],
      p_max_attempts: 3,
    });
  });

  it("releases the invoice for 900 s on a 401 and reports it", async () => {
    const { run, rpcArgs } = setup({
      replies: [{ body: errorBody("authentication_error"), status: 401 }],
    });
    await run();
    expect(rpcArgs("extraction_release")).toEqual([
      {
        p_invoice: INVOICE,
        p_claim_token: TOKEN,
        p_code: "provider_auth",
        p_backoff_seconds: PROVIDER_AUTH_BACKOFF_SECONDS,
      },
    ]);
    expect(rpcArgs("extraction_fail")).toEqual([]);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0]?.[0])).toContain("provider_auth");
  });

  it("falls back to extraction_fail(store_failed) when completion errors, without content", async () => {
    const { run, rpcArgs } = setup({
      complete: { data: null, error: { message: "Prodotto di prova A violates", code: "23514" } },
    });
    await run();
    expect(rpcArgs("extraction_fail")[0]).toMatchObject({
      p_code: "store_failed",
      p_retryable: false,
    });
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = reportError.mock.calls[0]?.[0] as Error;
    expect(reported.message).toContain(INVOICE);
    expect(reported.message).toContain("23514");
    expect(reported.message).not.toContain("Prodotto");
  });

  it("throws when even the failure cannot be recorded", async () => {
    const admin = fakeSupabase({
      rpc: {
        extraction_claim: [ok([claimRow()])],
        extraction_fail: [{ data: null, error: { message: "down", code: "08006" } }],
      },
      storage: { download: [{ data: null, error: { message: "boom" } }] },
    });
    await expect(
      runExtractionJob({
        admin: admin as unknown as SupabaseClient,
        makeClient: () =>
          createExtractionClient(ENV, fakeAnthropicFetch([]).fetchImpl as typeof fetch),
        readEnv: () => ENV,
        now: () => 0,
      }),
    ).rejects.toThrow("extraction_fail");
  });
});
