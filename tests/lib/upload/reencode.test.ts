import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reencodeForUpload, JPEG_QUALITY } from "@/lib/upload/reencode";
import { fakeHeic, fakeJpeg, fakePdf, fakePng } from "../../helpers/fake-files";

const UNSUPPORTED =
  "Questo formato di foto non è supportato da questo browser: su iPhone scegli 'Più compatibile' oppure carica un PDF o una foto JPEG.";

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
    expect(JPEG_QUALITY).toBeCloseTo(0.9);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
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

  it("returns the message when the canvas has no 2D context", async () => {
    canvas.getContext = () => null;
    const result = await reencodeForUpload(fileOf(fakeHeic(), "a.heic", "image/heic"));
    expect(result).toEqual({ ok: false, message: UNSUPPORTED });
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("returns the message when toBlob yields nothing", async () => {
    toBlob.mockImplementation((cb: (b: Blob | null) => void) => cb(null));
    const result = await reencodeForUpload(fileOf(fakeHeic(), "a.heic", "image/heic"));
    expect(result).toEqual({ ok: false, message: UNSUPPORTED });
  });
});
