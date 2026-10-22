import { t } from "@/lib/i18n";

export const JPEG_QUALITY = 0.9;

export type ReencodeResult = { ok: true; file: File } | { ok: false; message: string };

function isHeic(file: File): boolean {
  return file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name);
}

function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

/**
 * Browser-only. iPhone photos can arrive as HEIC/HEIF, which the server rejects (it accepts PDF,
 * JPEG and PNG only). Where the browser can decode them, they are redrawn on a canvas and
 * re-encoded to JPEG; everything else passes through untouched.
 */
export async function reencodeForUpload(file: File): Promise<ReencodeResult> {
  if (!isHeic(file)) return { ok: true, file };
  const failure: ReencodeResult = { ok: false, message: t("invoices.photoUnsupported") };

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return failure;
    context.drawImage(bitmap, 0, 0);
    const blob = await toJpegBlob(canvas);
    if (!blob) return failure;
    const base = file.name.replace(/\.[^.]*$/, "") || "foto";
    return { ok: true, file: new File([blob], `${base}.jpg`, { type: "image/jpeg" }) };
  } catch {
    return failure;
  } finally {
    bitmap?.close();
  }
}
