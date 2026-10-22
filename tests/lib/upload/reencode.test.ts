import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";
import {
  JPEG_QUALITY,
  MAX_HEIC_INPUT_BYTES,
  PHOTO_MAX_SIDE_PX,
  pickSizeError,
  RETRY_JPEG_QUALITY,
  reencodeForUpload,
} from "@/lib/upload/reencode";
import { fakeHeic, fakeJpeg, fakePdf, fakePng } from "../../helpers/fake-files";

const UNSUPPORTED =
  "Questo formato di foto non è supportato da questo browser: su iPhone scegli «Più compatibile» (vale per le foto nuove) oppure carica un PDF o una foto JPEG.";

const ENCODE_FAILED = "Non è stato possibile convertire la foto: riprova o carica un PDF.";
const TOO_BIG =
  "La foto è troppo grande anche dopo la conversione: scatta di nuovo con meno dettaglio oppure carica un PDF.";

const bigBlob = (type: string) => new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type });
const heic = () => fileOf(fakeHeic(), "a.heic", "image/heic");

const bitmap = { width: 400, height: 300, close: vi.fn() };
const drawImage = vi.fn();
const toBlob = vi.fn();
const createImageBitmap = vi.fn();
let canvas: { width: number; height: number; getContext: () => unknown; toBlob: typeof toBlob };

function fileOf(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as BlobPart], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  createImageBitmap.mockResolvedValue(bitmap);
  toBlob.mockImplementation((cb: (b: Blob | null) => void, type: string) =>
    cb(new Blob([fakeJpeg() as BlobPart], { type })),
  );
  canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
});

afterEach(() => vi.unstubAllGlobals());

describe("reencodeForUpload", () => {
  it.each([
    ["image/heic", "IMG_0001.HEIC"],
    ["image/heif", "foto.heif"],
    ["", "IMG_0002.heic"],
    ["application/octet-stream", "scan.HEIF"],
  ])("re-encodes %s %s to a .jpg JPEG", async (type, name) => {
    const result = await reencodeForUpload(fileOf(fakeHeic(), name, type));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe(`${name.replace(/\.[^.]+$/, "")}.jpg`);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", JPEG_QUALITY);
    expect(JPEG_QUALITY).toBeCloseTo(0.85);
    expect(RETRY_JPEG_QUALITY).toBeCloseTo(0.7);
    expect(PHOTO_MAX_SIDE_PX).toBe(2400);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 400, 300);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("keeps a name with several dots intact apart from the extension", async () => {
    const result = await reencodeForUpload(fileOf(fakeHeic(), "fattura.1.2026.heic", "image/heic"));
    expect(result.ok && result.file.name).toBe("fattura.1.2026.jpg");
  });

  it.each([
    [fakePdf(), "f.pdf", "application/pdf"],
    [fakeJpeg(), "f.jpg", "image/jpeg"],
    [fakePng(), "f.png", "image/png"],
  ])("passes %s through untouched", async (bytes, name, type) => {
    const file = fileOf(bytes, name, type);
    const result = await reencodeForUpload(file);
    expect(result).toEqual({ ok: true, file });
    expect(result.ok && result.file).toBe(file);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("returns the Italian message when the browser cannot decode the photo", async () => {
    createImageBitmap.mockRejectedValue(new Error("nope"));
    const result = await reencodeForUpload(fileOf(fakeHeic(), "a.heic", "image/heic"));
    expect(result).toEqual({ ok: false, message: UNSUPPORTED });
  });

  it("returns the same message when createImageBitmap is missing", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const result = await reencodeForUpload(fileOf(fakeHeic(), "a.heic", "image/heic"));
    expect(result).toEqual({ ok: false, message: UNSUPPORTED });
  });

  it("returns the encode-failure message when the canvas has no 2D context", async () => {
    canvas.getContext = () => null;
    const result = await reencodeForUpload(heic());
    expect(result).toEqual({ ok: false, message: ENCODE_FAILED });
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("returns the encode-failure message when toBlob yields nothing", async () => {
    toBlob.mockImplementation((cb: (b: Blob | null) => void) => cb(null));
    expect(await reencodeForUpload(heic())).toEqual({ ok: false, message: ENCODE_FAILED });
  });

  it("downscales a 5712x4284 bitmap to a 2400 px long side, keeping the aspect ratio", async () => {
    createImageBitmap.mockResolvedValue({ width: 5712, height: 4284, close: vi.fn() });
    const result = await reencodeForUpload(heic());
    expect(result.ok).toBe(true);
    expect(canvas.width).toBe(2400);
    expect(canvas.height).toBe(1800);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2400, 1800);
  });

  it("downscales a portrait bitmap by its height", async () => {
    createImageBitmap.mockResolvedValue({ width: 3000, height: 6000, close: vi.fn() });
    await reencodeForUpload(heic());
    expect([canvas.width, canvas.height]).toEqual([1200, 2400]);
  });

  it("does not upscale a small bitmap", async () => {
    createImageBitmap.mockResolvedValue({ width: 800, height: 600, close: vi.fn() });
    await reencodeForUpload(heic());
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
  });

  it("retries once at a lower quality when the first blob is over the limit", async () => {
    toBlob
      .mockImplementationOnce((cb: (b: Blob | null) => void, type: string) => cb(bigBlob(type)))
      .mockImplementationOnce((cb: (b: Blob | null) => void, type: string) =>
        cb(new Blob([fakeJpeg() as BlobPart], { type })),
      );
    const result = await reencodeForUpload(heic());
    expect(result.ok).toBe(true);
    expect(toBlob).toHaveBeenCalledTimes(2);
    expect(toBlob).toHaveBeenNthCalledWith(1, expect.any(Function), "image/jpeg", JPEG_QUALITY);
    expect(toBlob).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      "image/jpeg",
      RETRY_JPEG_QUALITY,
    );
  });

  it("gives the too-big result when both attempts are over the limit", async () => {
    toBlob.mockImplementation((cb: (b: Blob | null) => void, type: string) => cb(bigBlob(type)));
    const result = await reencodeForUpload(heic());
    expect(result).toEqual({ ok: false, message: TOO_BIG });
    expect(toBlob).toHaveBeenCalledTimes(2);
  });

  it("accepts a blob of exactly the limit without a retry", async () => {
    toBlob.mockImplementation((cb: (b: Blob | null) => void, type: string) =>
      cb(new Blob([new Uint8Array(MAX_UPLOAD_BYTES)], { type })),
    );
    expect((await reencodeForUpload(heic())).ok).toBe(true);
    expect(toBlob).toHaveBeenCalledTimes(1);
  });

  it("returns the encode-failure message when the retry encode fails", async () => {
    toBlob
      .mockImplementationOnce((cb: (b: Blob | null) => void, type: string) => cb(bigBlob(type)))
      .mockImplementationOnce((cb: (b: Blob | null) => void) => cb(null));
    expect(await reencodeForUpload(heic())).toEqual({ ok: false, message: ENCODE_FAILED });
  });
});

// Round 2 of the #7 review: a 48 MP HEIC (5–8 MB) must reach the re-encode, not be refused at pick.
describe("pickSizeError", () => {
  const sized = (bytes: number, name: string, type: string) =>
    new File([new Uint8Array(bytes)], name, { type });

  it("lets a HEIC over 4 MiB through to the re-encode", () => {
    expect(pickSizeError(sized(MAX_UPLOAD_BYTES * 2, "IMG_0001.HEIC", ""))).toBeNull();
    expect(pickSizeError(sized(MAX_UPLOAD_BYTES + 1, "a.heif", "image/heif"))).toBeNull();
  });

  it("refuses a HEIC above the decode cap with its own message", () => {
    expect(pickSizeError(sized(MAX_HEIC_INPUT_BYTES + 1, "a.heic", "image/heic"))).toBe(
      "heicTooBig",
    );
    expect(pickSizeError(sized(MAX_HEIC_INPUT_BYTES, "a.heic", "image/heic"))).toBeNull();
  });

  it("still refuses a PDF, JPEG or PNG over 4 MiB at pick time", () => {
    for (const [name, type] of [
      ["a.pdf", "application/pdf"],
      ["a.jpg", "image/jpeg"],
      ["a.png", "image/png"],
    ] as const) {
      expect(pickSizeError(sized(MAX_UPLOAD_BYTES + 1, name, type))).toBe("tooBig");
      expect(pickSizeError(sized(MAX_UPLOAD_BYTES, name, type))).toBeNull();
    }
  });
});
