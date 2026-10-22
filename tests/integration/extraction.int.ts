import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExtractionEnv } from "@/lib/env";
import { runExtractionJob } from "@/server/cron/extract-job";
import { createExtractionClient } from "@/server/extraction/client";
import { INVOICE_BUCKET } from "@/server/invoices/constants";
import { listInvoices, storeInvoiceUpload } from "@/server/invoices/invoices";
import { venueYear } from "@/lib/time/venue-date";
import {
  errorBody,
  fakeAnthropicFetch,
  fixture,
  type FakeReply,
} from "../helpers/fake-anthropic-fetch";
import { fakePdf, fakePng } from "../helpers/fake-files";
import { validExtraction } from "../helpers/extraction-data";
import { createStack, readStackEnv, type Stack, type TestTenant } from "./helpers/stack";

// M3 acceptance tests 1, 2, 3, 4, 6 and 7, the founder name rule and the duplicate race, against
// the real local stack (Auth, PostgREST, Storage, the extraction_* procedures). Only the
// Anthropic API is faked: the real SDK parses recorded responses served by a fake `fetch`.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const PDF_MIME = "application/pdf";
const FAKE_ENV: ExtractionEnv = { anthropicApiKey: "test-key", modelId: "test-model" };
const SECOND_MS = 1000;
const FAR_FUTURE_MS = 24 * 3600 * SECOND_MS;
const FIRST_BACKOFF_S = 60;
const SECOND_BACKOFF_S = 300;
/** DB clock and test clock are the same machine in CI; the window only absorbs the request time. */
const BACKOFF_SLACK_S = 30;

interface MessageBody {
  content: { type: string; text: string }[];
  [key: string]: unknown;
}

/** A recorded response whose invoice number is replaced, so scenarios never collide as duplicates. */
function fixtureWith(name: string, patch: Record<string, unknown>): FakeReply {
  const message = fixture(name) as MessageBody;
  const data = JSON.parse(message.content[0]!.text) as Record<string, unknown>;
  return {
    body: {
      ...message,
      content: [{ type: "text", text: JSON.stringify({ ...data, ...patch }) }],
    },
    status: 200,
  };
}

const serverError = (): FakeReply => ({ body: errorBody("api_error"), status: 500 });

describe.skipIf(!env)("invoice extraction on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  const uploadedAt = new Date();

  /** Park every waiting invoice so the next claim can only pick the ones uploaded after this. */
  async function parkQueue() {
    const parked = await stack.admin
      .from("invoice")
      .update({ next_attempt_at: new Date(Date.now() + FAR_FUTURE_MS).toISOString() })
      .eq("status", "received");
    expect(parked.error).toBeNull();
  }

  async function upload(tenant: TestTenant = a): Promise<string> {
    const stored = await storeInvoiceUpload(
      tenant.owner.client,
      { tenantId: tenant.id },
      { bytes: fakePdf(), declaredMime: PDF_MIME, filename: "fattura-demo.pdf" },
      uploadedAt,
    );
    return stored.id;
  }

  /** Uploads one invoice (after parking the queue) and runs the job once with the given replies. */
  async function uploadAndRun(replies: FakeReply[]) {
    await parkQueue();
    const id = await upload();
    const outcome = await runJob(replies);
    expect(outcome.result).toMatchObject({ claimed: id });
    return { id, ...outcome };
  }

  async function runJob(replies: FakeReply[]) {
    const fake = fakeAnthropicFetch(replies);
    const result = await runExtractionJob({
      admin: stack.admin,
      makeClient: (e) => createExtractionClient(e, fake.fetchImpl),
      readEnv: () => FAKE_ENV,
      now: Date.now,
    });
    return { result, fake };
  }

  async function row(id: string) {
    const { data, error } = await stack.admin.from("invoice").select("*").eq("id", id).single();
    expect(error).toBeNull();
    return data as Record<string, unknown>;
  }

  async function lines(id: string) {
    const { data, error } = await stack.admin
      .from("invoice_line")
      .select("*")
      .eq("invoice_id", id)
      .order("position");
    expect(error).toBeNull();
    return data ?? [];
  }

  const number = () => `FT ${randomUUID().slice(0, 8)}/2026`;

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
  });

  describe("AT1: a valid response lands in review with lines, lot and expiry", () => {
    it("stores the header and two lines, readable by owner A only", async () => {
      const { id, fake } = await uploadAndRun([fixtureWith("valid", { invoice_number: number() })]);

      expect(fake.fetchImpl).toHaveBeenCalledTimes(1);
      expect(await row(id)).toMatchObject({
        status: "review",
        attempts: 1,
        gate_flags: [],
        extraction_error: null,
        extraction_model: FAKE_ENV.modelId,
        claim_token: null,
        supplier_vat: "IT12345678903",
      });
      const stored = await lines(id);
      expect(stored).toHaveLength(2);
      expect(stored[0]).toMatchObject({
        position: 1,
        raw_description: "Prodotto di prova A",
        lot_code: "L-0425",
        expiry: "2026-11-30",
      });
      expect(stored[1]).toMatchObject({ position: 2, lot_code: null, expiry: null });

      const seenByOwner = await a.owner.client
        .from("invoice_line")
        .select("id")
        .eq("invoice_id", id);
      expect(seenByOwner.error).toBeNull();
      expect(seenByOwner.data).toHaveLength(2);
      for (const other of [b.owner, a.chef, a.waiter]) {
        const seen = await other.client.from("invoice_line").select("id").eq("invoice_id", id);
        expect(seen.data ?? []).toEqual([]);
      }
    });
  });

  describe("AT2: the totals gate", () => {
    it("a gross total 0.06 off is flagged total_mismatch and still lands in review", async () => {
      const { id } = await uploadAndRun([
        fixtureWith("mismatch-006", { invoice_number: number() }),
      ]);
      const stored = await row(id);
      expect(stored).toMatchObject({ status: "review", gate_flags: ["total_mismatch"] });
      expect(Number(stored.totals_diff)).toBeCloseTo(-0.06, 4);
    });

    it("a gross total 0.05 off is not flagged", async () => {
      const data = { ...validExtraction(), invoice_number: number(), gross_total: 33.05 };
      const { id } = await uploadAndRun([
        {
          body: {
            ...(fixture("valid") as MessageBody),
            content: [{ type: "text", text: JSON.stringify(data) }],
          },
          status: 200,
        },
      ]);
      expect(await row(id)).toMatchObject({ status: "review", gate_flags: [] });
    });
  });

  describe("AT3: an invalid response is rejected and nothing is stored", () => {
    it.each(["extra-key", "negative-qty", "long-description", "not-json"])(
      "%s -> extraction_failed / schema_invalid, no lines",
      async (name) => {
        const reply: FakeReply =
          name === "not-json" ? { fixture: name } : fixtureWith(name, { invoice_number: number() });
        const { id, fake } = await uploadAndRun([reply]);
        expect(fake.fetchImpl).toHaveBeenCalledTimes(1);
        expect(await row(id)).toMatchObject({
          status: "extraction_failed",
          extraction_error: "schema_invalid",
          attempts: 1,
          extraction_json: null,
        });
        expect(await lines(id)).toEqual([]);
      },
    );
  });

  describe("AT4: text inside the document stays data", () => {
    it("keeps the injected text verbatim, prices as printed, never approved", async () => {
      const { id, fake } = await uploadAndRun([
        fixtureWith("injection", { invoice_number: number() }),
      ]);
      const stored = await row(id);
      expect(stored.status).toBe("review");
      expect(stored.status).not.toBe("approved");
      expect(String(stored.payment_terms)).toContain("ignore previous instructions");

      const rows = await lines(id);
      expect(rows.map((line) => Number(line.unit_price))).toEqual([12.5, 8]);
      expect(String(rows[0]!.raw_description)).toContain("ignore previous instructions");
      // The request carried the document as data in the user message, with no tools.
      expect(fake.calls[0]!.body).not.toHaveProperty("tools");
    });
  });

  describe("AT6: a second upload of the same invoice", () => {
    it("is marked duplicate of the first and shows in the invoice list", async () => {
      const reply = () => fixtureWith("valid", { invoice_number: "FT 77/2026" });
      const first = await uploadAndRun([reply()]);
      expect((await row(first.id)).status).toBe("review");

      const second = await uploadAndRun([reply()]);
      expect(await row(second.id)).toMatchObject({
        status: "duplicate",
        duplicate_of: first.id,
      });

      const listed = await listInvoices(a.owner.client, { status: "duplicate" });
      expect(listed.find((item) => item.id === second.id)).toMatchObject({
        status: "duplicate",
        duplicateOf: first.id,
      });
    });

    it("FT-1-2026 is a different number than FT 1/2026 (founder rule): no duplicate", async () => {
      const first = await uploadAndRun([
        fixtureWith("valid", { invoice_number: "FT 5/2026", invoice_date: "2026-09-01" }),
      ]);
      const second = await uploadAndRun([
        fixtureWith("valid", { invoice_number: "FT-5-2026", invoice_date: "2026-09-01" }),
      ]);
      expect((await row(first.id)).status).toBe("review");
      expect(await row(second.id)).toMatchObject({ status: "review", duplicate_of: null });
    });
  });

  describe("founder rule: no VAT number", () => {
    it("a second upload with the same name, number and date is review with a warning", async () => {
      const patch = { supplier_vat: null, invoice_number: "NV 9/2026", invoice_date: "2026-08-01" };
      const first = await uploadAndRun([fixtureWith("valid", patch)]);
      const second = await uploadAndRun([fixtureWith("valid", patch)]);

      expect(await row(first.id)).toMatchObject({ status: "review", duplicate_warning_of: null });
      expect(await row(second.id)).toMatchObject({
        status: "review",
        duplicate_of: null,
        duplicate_warning_of: first.id,
      });
    });
  });

  describe("duplicate race: two workers on the same invoice at the same moment", () => {
    it("ends with exactly one review and one duplicate", async () => {
      const patch = { invoice_number: "RACE 1/2026", invoice_date: "2026-07-01" };
      await parkQueue();
      const ids = [await upload(), await upload()];

      const [x, y] = await Promise.all([
        runJob([fixtureWith("valid", patch)]),
        runJob([fixtureWith("valid", patch)]),
      ]);
      const claimed = [x.result, y.result].map((r) => ("claimed" in r ? r.claimed : null));
      expect([...claimed].sort()).toEqual([...ids].sort());

      const rows = await Promise.all(ids.map(row));
      expect(rows.map((r) => r.status).sort()).toEqual(["duplicate", "review"]);
      const kept = rows.find((r) => r.status === "review")!;
      const dup = rows.find((r) => r.status === "duplicate")!;
      expect(dup.duplicate_of).toBe(kept.id);
    });
  });

  describe("AT7: provider failures are retried with backoff, then fail", () => {
    it("500 three times: attempts 1, 2, 3, then extraction_failed", async () => {
      await parkQueue();
      const id = await upload();
      const secondsAhead = async () =>
        (new Date(String((await row(id)).next_attempt_at)).getTime() - Date.now()) / SECOND_MS;
      const moveClockPastBackoff = async () => {
        const moved = await stack.admin
          .from("invoice")
          .update({ next_attempt_at: new Date(Date.now() - SECOND_MS).toISOString() })
          .eq("id", id);
        expect(moved.error).toBeNull();
      };

      let outcome = await runJob([serverError()]);
      expect(outcome.result).toEqual({ claimed: id, status: "received" });
      expect(await row(id)).toMatchObject({
        attempts: 1,
        extraction_error: "provider_unavailable",
      });
      expect(Math.abs((await secondsAhead()) - FIRST_BACKOFF_S)).toBeLessThan(BACKOFF_SLACK_S);

      // Before the backoff has passed nothing is claimed and the provider is not called.
      outcome = await runJob([]);
      expect(outcome.result).toEqual({ claimed: null });
      expect(outcome.fake.fetchImpl).not.toHaveBeenCalled();

      await moveClockPastBackoff();
      outcome = await runJob([serverError()]);
      expect(outcome.result).toEqual({ claimed: id, status: "received" });
      expect(await row(id)).toMatchObject({ attempts: 2, status: "received" });
      expect(Math.abs((await secondsAhead()) - SECOND_BACKOFF_S)).toBeLessThan(BACKOFF_SLACK_S);

      await moveClockPastBackoff();
      outcome = await runJob([serverError()]);
      expect(outcome.result).toEqual({ claimed: id, status: "extraction_failed" });
      expect(await row(id)).toMatchObject({
        attempts: 3,
        status: "extraction_failed",
        extraction_error: "provider_unavailable",
        next_attempt_at: null,
      });
      expect(await lines(id)).toEqual([]);
    });
  });

  describe("re-sniff: an object that is not what its row says", () => {
    it("PNG bytes behind a .pdf path -> file_mismatch, the provider is never called", async () => {
      await parkQueue();
      const id = randomUUID();
      const path = `${a.id}/${venueYear(uploadedAt)}/${id}.pdf`;
      const png = fakePng();

      const stored = await a.owner.client.storage
        .from(INVOICE_BUCKET)
        .upload(path, png, { contentType: PDF_MIME, upsert: false });
      expect(stored.error).toBeNull();
      const inserted = await a.owner.client.from("invoice").insert({
        id,
        file_path: path,
        file_mime: PDF_MIME,
        file_size_bytes: png.byteLength,
        original_filename: "finta.pdf",
      });
      expect(inserted.error).toBeNull();

      const { result, fake } = await runJob([]);
      expect(result).toEqual({ claimed: id, status: "extraction_failed" });
      expect(fake.fetchImpl).not.toHaveBeenCalled();
      expect(await row(id)).toMatchObject({
        status: "extraction_failed",
        extraction_error: "file_mismatch",
      });
      expect(await lines(id)).toEqual([]);
    });
  });
});
