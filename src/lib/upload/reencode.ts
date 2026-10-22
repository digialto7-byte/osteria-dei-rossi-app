import { t } from "@/lib/i18n";
import { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";

export const JPEG_QUALITY = 0.85;
export const RETRY_JPEG_QUALITY = 0.7;
/** Long side cap: keeps the canvas far below the iOS Safari ~16.7 MP limit (2400x1800 = 4.3 MP). */
export const PHOTO_MAX_SIDE_PX = 2400;

export type ReencodeResult = { ok: true; file: File } | { ok: false; message: string };

function isHeic(file: File): boolean {
  return file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name);
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Browser-only. iPhone photos can arrive as HEIC/HEIF, which the server rejects (it accepts PDF,
 * JPEG and PNG only). Where the browser can decode them, they are redrawn on a canvas (long side
 * capped at PHOTO_MAX_SIDE_PX) and re-encoded to JPEG that fits MAX_UPLOAD_BYTES, with one retry
 * at a lower quality. Everything else passes through untouched.
 */
export async function reencodeForUpload(file: File): Promise<ReencodeResult> {
  if (!isHeic(file)) return { ok: true, file };
  const fail = (
    key:
      | "invoices.photoUnsupported"
      | "invoices.photoEncodeFailed"
      | "invoices.photoTooBigAfterConversion",
  ): ReencodeResult => ({
    ok: false,
    message: t(key),
  });

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fail("invoices.photoUnsupported");
  }
  try {
    const scale = Math.min(1, PHOTO_MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return fail("invoices.photoEncodeFailed");
    context.drawImage(bitmap, 0, 0, width, height);

    let blob: Blob | null = null;
    for (const quality of [JPEG_QUALITY, RETRY_JPEG_QUALITY]) {
      blob = await toJpegBlob(canvas, quality);
      if (!blob) return fail("invoices.photoEncodeFailed");
      if (blob.size <= MAX_UPLOAD_BYTES) break;
    }
    if (!blob || blob.size > MAX_UPLOAD_BYTES) return fail("invoices.photoTooBigAfterConversion");
    const base = file.name.replace(/\.[^.]*$/, "") || "foto";
    return { ok: true, file: new File([blob], `${base}.jpg`, { type: "image/jpeg" }) };
  } catch {
    return fail("invoices.photoEncodeFailed");
  } finally {
    bitmap.close();
  }
}
