import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";

const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
const { createInvoiceFileUrl } = await import("@/server/invoices/invoices");

const ID = "1b000000-0000-4000-8000-0000000000b1";
const TENANT = "11111111-1111-4111-8111-111111111111";
const SIGNED = "https://storage.example.test/object/sign/invoices/x?token=BEARER-TOKEN";
const NOW = new Date("1998-11-03T10:00:00Z");
const ok = (data: unknown): FakeResult => ({ data, error: null });

function client(row: Record<string, unknown> | null) {
  return fakeSupabase({
    results: { invoice: [ok(row)] },
    storage: { createSignedUrl: [{ data: { signedUrl: SIGNED }, error: null }] },
  });
}
const urlFor = async (row: Record<string, unknown>, fake = client(row)) => ({
  fake,
  reply: await createInvoiceFileUrl(fake as never, ID, 300, NOW),
});

beforeEach(() => reportError.mockReset());

describe("createInvoiceFileUrl for e-invoice files", () => {
  it("reads the name and type with the path", async () => {
    const { fake } = await urlFor({
      file_path: `${TENANT}/1998/${ID}.xml`,
      file_mime: "application/xml",
      original_filename: "a.xml",
    });
    expect(fake.query.select).toHaveBeenCalledWith("file_path, file_mime, original_filename");
  });

  it.each([
    ["application/xml", "xml"],
    ["application/pkcs7-mime", "p7m"],
  ])("hands out the app route for %s, never a Storage URL", async (mime, ext) => {
    const { fake, reply } = await urlFor({
      file_path: `${TENANT}/1998/${ID}.${ext}`,
      file_mime: mime,
      original_filename: "IT01234567890_00001.xml",
    });
    expect(fake.storage.createSignedUrl).not.toHaveBeenCalled();
    expect(reply).toEqual({
      url: `/api/invoices/${ID}/original`,
      expiresAt: null,
      disposition: "attachment",
    });
    expect(JSON.stringify(reply)).not.toMatch(
      /supabase\.co|\/storage\/v1\/|token=|storage\.example/,
    );
  });

  it("keeps a document inline: no download option, disposition inline", async () => {
    const path = `${TENANT}/1998/${ID}.pdf`;
    const { fake, reply } = await urlFor({
      file_path: path,
      file_mime: "application/pdf",
      original_filename: "x.pdf",
    });
    expect(fake.storage.createSignedUrl.mock.calls[0]).toEqual([path, 300]);
    expect(reply.disposition).toBe("inline");
  });

  it("never reports the signed URL of a document, on failure", async () => {
    const failing = fakeSupabase({
      results: {
        invoice: [
          ok({
            file_path: `${TENANT}/1998/${ID}.pdf`,
            file_mime: "application/pdf",
            original_filename: null,
          }),
        ],
      },
      storage: { createSignedUrl: [{ data: null, error: { message: SIGNED } }] },
    });
    await expect(createInvoiceFileUrl(failing as never, ID)).rejects.toMatchObject({ status: 502 });
    expect(JSON.stringify(reportError.mock.calls)).not.toContain("BEARER-TOKEN");
  });
});
