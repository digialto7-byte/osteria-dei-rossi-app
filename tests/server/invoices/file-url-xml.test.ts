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
    ["application/xml", "xml", "IT01234567890_00001.xml", "IT01234567890_00001.xml"],
    ["application/pkcs7-mime", "p7m", "IT01234567890_00001.xml.p7m", "IT01234567890_00001.xml.p7m"],
    ["application/xml", "xml", null, "fattura.xml"],
    ["application/pkcs7-mime", "p7m", null, "fattura.xml.p7m"],
  ])("signs %s for a download named %s", async (mime, ext, name, download) => {
    const path = `${TENANT}/1998/${ID}.${ext}`;
    const { fake, reply } = await urlFor({
      file_path: path,
      file_mime: mime,
      original_filename: name,
    });
    expect(fake.storage.createSignedUrl).toHaveBeenCalledWith(path, 300, { download });
    expect(reply).toEqual({
      url: SIGNED,
      expiresAt: "1998-11-03T10:05:00.000Z",
      disposition: "attachment",
    });
  });

  it.each([
    ["a path and a quote", '../x/b"x;y.xml', "xml", "b_x_y.xml"],
    ["bidi and control characters", "fa‮ttura\u0000.xml", "xml", "fattura.xml"],
    ["no extension", "IT01234567890_00001", "xml", "IT01234567890_00001.xml"],
    ["a dangerous extension", "page.html", "xml", "page.html.xml"],
    ["a p7m without its extension", "fattura.xml", "p7m", "fattura.xml.p7m"],
    ["an empty name after cleaning", "‮", "xml", "fattura.xml"],
  ])("names the download safely: %s", async (_label, name, ext, expected) => {
    const mime = ext === "xml" ? "application/xml" : "application/pkcs7-mime";
    const { fake } = await urlFor({
      file_path: `${TENANT}/1998/${ID}.${ext}`,
      file_mime: mime,
      original_filename: name,
    });
    expect(fake.storage.createSignedUrl.mock.calls[0]![2]).toEqual({ download: expected });
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

  it("never reports the signed URL, on success or on failure", async () => {
    await urlFor({
      file_path: `${TENANT}/1998/${ID}.xml`,
      file_mime: "application/xml",
      original_filename: null,
    });
    const failing = fakeSupabase({
      results: {
        invoice: [
          ok({
            file_path: `${TENANT}/1998/${ID}.xml`,
            file_mime: "application/xml",
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
