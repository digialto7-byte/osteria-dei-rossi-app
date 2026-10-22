import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { venueYear } from "@/lib/time/venue-date";
import { INVOICE_BUCKET } from "@/server/invoices/constants";
import {
  createInvoiceFileUrl,
  storeInvoiceUpload,
  type UploadedInvoice,
} from "@/server/invoices/invoices";
import { fakePdf, padTo } from "../helpers/fake-files";
import { createStack, readStackEnv, type Stack, type TestTenant } from "./helpers/stack";

// M2 acceptance tests 1, 3, 4, 5, 6 against the real local stack (Auth, PostgREST, Storage), with
// real user JWTs. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const PDF_MIME = "application/pdf";
const SECOND_MS = 1000;
const SHORT_TTL_SECONDS = 1;
const PAST_TTL_WAIT_MS = 3500;
const SIGN_ATTEMPTS = 4;
/** Slack before the next whole second: leaves most of a 1 s TTL for the request. */
const SECOND_START_WINDOW_MS = 150;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const bytesOf = (response: Response) => response.arrayBuffer().then((b) => new Uint8Array(b));
const startsWithPdfMagic = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

describe.skipIf(!env)("invoice storage on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let uploaded: UploadedInvoice;
  let uploadedPath: string;
  const uploadedAt = new Date();

  const upload = (
    client: SupabaseClient,
    path: string,
    bytes: Uint8Array,
    options: { contentType: string; upsert?: boolean },
  ) => client.storage.from(INVOICE_BUCKET).upload(path, bytes, options);

  const objectPath = (tenant: TestTenant, ext = "pdf") =>
    `${tenant.id}/${venueYear(uploadedAt)}/${randomUUID()}.${ext}`;

  const objectExists = async (path: string) => {
    const slash = path.lastIndexOf("/");
    const { data, error } = await stack.admin.storage
      .from(INVOICE_BUCKET)
      .list(path.slice(0, slash), { search: path.slice(slash + 1) });
    expect(error).toBeNull();
    return (data ?? []).some((entry) => entry.name === path.slice(slash + 1));
  };

  const invoiceCount = async (tenant: TestTenant) => {
    const { count, error } = await stack.admin
      .from("invoice")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);
    expect(error).toBeNull();
    return count;
  };

  /** A signed URL that is still valid: signed right after a clock-second boundary, then fetched. */
  async function fetchWithinShortTtl(client: SupabaseClient, id: string) {
    for (let attempt = 1; ; attempt++) {
      const into = Date.now() % SECOND_MS;
      if (into > SECOND_START_WINDOW_MS) await pause(SECOND_MS - into);
      const { url } = await createInvoiceFileUrl(client, id, SHORT_TTL_SECONDS);
      const response = await fetch(url);
      if (response.ok || attempt >= SIGN_ATTEMPTS) return { url, response };
    }
  }

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    uploaded = await storeInvoiceUpload(
      a.owner.client,
      { tenantId: a.id },
      { bytes: fakePdf(), declaredMime: PDF_MIME, filename: "fattura-demo.pdf" },
      uploadedAt,
    );
    const row = await stack.admin
      .from("invoice")
      .select("file_path")
      .eq("id", uploaded.id)
      .single();
    expect(row.error).toBeNull();
    uploadedPath = row.data!.file_path as string;
  });

  describe("AT1: owner uploads a PDF", () => {
    it("returns a received invoice for the owner's tenant", async () => {
      expect(uploaded).toMatchObject({
        status: "received",
        source: "upload",
        fileMime: PDF_MIME,
        fileSizeBytes: fakePdf().byteLength,
        originalFilename: "fattura-demo.pdf",
      });
      const row = await stack.admin
        .from("invoice")
        .select("tenant_id, status, created_by")
        .eq("id", uploaded.id)
        .single();
      expect(row.data).toMatchObject({ tenant_id: a.id, status: "received" });
      expect(row.data?.created_by).not.toBeNull();
    });

    it("stores the object at <tenant>/<year>/<id>.pdf, listed for the owner", async () => {
      expect(uploadedPath).toBe(`${a.id}/${venueYear(uploadedAt)}/${uploaded.id}.pdf`);
      const listed = await a.owner.client.storage
        .from(INVOICE_BUCKET)
        .list(`${a.id}/${venueYear(uploadedAt)}`);
      expect(listed.error).toBeNull();
      expect(listed.data?.map((entry) => entry.name)).toContain(`${uploaded.id}.pdf`);
    });

    it("the owner reads the row through RLS; the bucket is private", async () => {
      const row = await a.owner.client
        .from("invoice")
        .select("id, status")
        .eq("id", uploaded.id)
        .maybeSingle();
      expect(row.data).toEqual({ id: uploaded.id, status: "received" });

      const buckets = await stack.admin.storage.getBucket(INVOICE_BUCKET);
      expect(buckets.data?.public).toBe(false);
    });
  });

  describe("AT3: chef and waiter cannot store", () => {
    it.each([
      ["chef", () => a.chef],
      ["waiter", () => a.waiter],
    ])("a %s uploading straight to the tenant folder is denied", async (_label, user) => {
      const path = objectPath(a);
      const result = await upload(user().client, path, fakePdf(), { contentType: PDF_MIME });
      expect(result.error).not.toBeNull();
      expect(await objectExists(path)).toBe(false);
    });

    it("storeInvoiceUpload as a chef fails and leaves no row", async () => {
      const before = await invoiceCount(a);
      await expect(
        storeInvoiceUpload(
          a.chef.client,
          { tenantId: a.id },
          { bytes: fakePdf(), declaredMime: PDF_MIME, filename: "x.pdf" },
          uploadedAt,
        ),
      ).rejects.toBeInstanceOf(ApiError);
      expect(await invoiceCount(a)).toBe(before);
    });

    it("chef and waiter see no invoices and no objects", async () => {
      for (const user of [a.chef, a.waiter]) {
        const rows = await user.client.from("invoice").select("id");
        expect(rows.error).toBeNull();
        expect(rows.data).toEqual([]);
        const listed = await user.client.storage
          .from(INVOICE_BUCKET)
          .list(`${a.id}/${venueYear(uploadedAt)}`);
        expect(listed.data ?? []).toEqual([]);
      }
    });

    it("the owner is held to the bucket: a text/html upload is rejected", async () => {
      const path = objectPath(a);
      const result = await upload(a.owner.client, path, fakePdf(), { contentType: "text/html" });
      expect(result.error).not.toBeNull();
      expect(await objectExists(path)).toBe(false);
    });

    it("the owner cannot write into another tenant's folder", async () => {
      const path = objectPath(b);
      const result = await upload(a.owner.client, path, fakePdf(), { contentType: PDF_MIME });
      expect(result.error).not.toBeNull();
      expect(await objectExists(path)).toBe(false);
    });
  });

  describe("AT4: signed URL TTL", () => {
    it("works within a 1 s TTL and is refused after it", async () => {
      const { url, response } = await fetchWithinShortTtl(a.owner.client, uploaded.id);
      expect(response.status).toBe(200);
      expect(startsWithPdfMagic(await bytesOf(response))).toBe(true);

      await pause(PAST_TTL_WAIT_MS);
      const late = await fetch(url);
      expect(late.ok).toBe(false);
      expect(startsWithPdfMagic(await bytesOf(late))).toBe(false);
    });

    it("a default signed URL carries the default expiry and serves the PDF", async () => {
      const { url, expiresAt } = await createInvoiceFileUrl(a.owner.client, uploaded.id);
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await bytesOf(response)).toEqual(fakePdf());
    });
  });

  describe("AT5: another tenant's owner", () => {
    it("createInvoiceFileUrl for A's invoice as owner B is a 404", async () => {
      const error = await createInvoiceFileUrl(b.owner.client, uploaded.id).catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 404, code: "not_found" });
    });

    it("signing A's path directly as owner B fails", async () => {
      const result = await b.owner.client.storage
        .from(INVOICE_BUCKET)
        .createSignedUrl(uploadedPath, 60);
      expect(result.error).not.toBeNull();
      expect(result.data?.signedUrl).toBeUndefined();
    });

    it("owner B sees none of A's rows or objects", async () => {
      const rows = await b.owner.client.from("invoice").select("id").eq("id", uploaded.id);
      expect(rows.data).toEqual([]);
      const listed = await b.owner.client.storage
        .from(INVOICE_BUCKET)
        .list(`${a.id}/${venueYear(uploadedAt)}`);
      expect(listed.data ?? []).toEqual([]);
      const download = await b.owner.client.storage.from(INVOICE_BUCKET).download(uploadedPath);
      expect(download.error).not.toBeNull();
    });
  });

  describe("AT6: no delete, no overwrite", () => {
    it.each([
      ["owner", () => a.owner],
      ["chef", () => a.chef],
      ["waiter", () => a.waiter],
    ])("remove() by the %s leaves the object downloadable", async (_label, user) => {
      // Storage may answer with an error or with an empty list; either way the object must stay.
      await user().client.storage.from(INVOICE_BUCKET).remove([uploadedPath]);
      expect(await objectExists(uploadedPath)).toBe(true);
      const { url } = await createInvoiceFileUrl(a.owner.client, uploaded.id);
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(startsWithPdfMagic(await bytesOf(response))).toBe(true);
    });

    it("moving the object is denied", async () => {
      const target = objectPath(a);
      const result = await a.owner.client.storage.from(INVOICE_BUCKET).move(uploadedPath, target);
      expect(result.error).not.toBeNull();
      expect(await objectExists(uploadedPath)).toBe(true);
      expect(await objectExists(target)).toBe(false);
    });

    it("upload to an existing path with upsert:true is an error and the bytes are unchanged", async () => {
      const replacement = padTo(fakePdf(), 200);
      const overwrite = await upload(a.owner.client, uploadedPath, replacement, {
        contentType: PDF_MIME,
        upsert: true,
      });
      expect(overwrite.error).not.toBeNull();

      const { url } = await createInvoiceFileUrl(a.owner.client, uploaded.id);
      expect(await bytesOf(await fetch(url))).toEqual(fakePdf());
    });

    it("upload to an existing path without upsert is an error too", async () => {
      const again = await upload(a.owner.client, uploadedPath, fakePdf(), {
        contentType: PDF_MIME,
        upsert: false,
      });
      expect(again.error).not.toBeNull();
    });
  });
});
