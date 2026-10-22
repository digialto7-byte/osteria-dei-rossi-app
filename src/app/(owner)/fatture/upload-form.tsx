"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field } from "@/components/ui";
import { apiUpload } from "@/lib/api/client";
import { formatBytes } from "@/lib/format/bytes";
import { t } from "@/lib/i18n";
import { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";
import { MAX_HEIC_INPUT_BYTES, pickSizeError, reencodeForUpload } from "@/lib/upload/reencode";

type Source = "camera" | "file";

const HEIC_ACCEPT = ".heic,.heif,image/heic,image/heif";
const fileInput = "min-h-tap w-full max-w-full text-base";

/**
 * Picks a photo (phone camera) or a file and sends it to POST /api/invoices. The size checks here
 * only give a friendly message early (a HEIC is checked after it is re-encoded); the server decides. An explicit "Carica" step keeps a
 * wrong pick from becoming an invoice, since invoices can never be deleted.
 */
export function UploadForm({ onUploaded }: { onUploaded: () => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [inputKeys, setInputKeys] = useState<Record<Source, number>>({ camera: 0, file: 0 });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const max = formatBytes(MAX_UPLOAD_BYTES);

  // A file input cannot be cleared from React state, so a new key remounts it empty.
  const clearInput = (source: Source) =>
    setInputKeys((keys) => ({ ...keys, [source]: keys[source] + 1 }));

  function choose(source: Source, picked: File | null) {
    setDone(false);
    const sizeError = picked ? pickSizeError(picked) : null;
    if (sizeError) {
      clearInput(source);
      setFile(null);
      setError(
        sizeError === "heicTooBig"
          ? t("invoices.heicTooBig", { max: formatBytes(MAX_HEIC_INPUT_BYTES) })
          : t("invoices.tooBig", { max }),
      );
      return;
    }
    setError(null);
    setFile(picked);
    if (picked) clearInput(source === "camera" ? "file" : "camera");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(false);
    const prepared = await reencodeForUpload(file);
    if (!prepared.ok) {
      setBusy(false);
      return setError(prepared.message);
    }
    if (prepared.file.size > MAX_UPLOAD_BYTES) {
      setBusy(false);
      return setError(t("invoices.tooBig", { max }));
    }
    const body = new FormData();
    body.append("file", prepared.file);
    const result = await apiUpload("/api/invoices", body);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setFile(null);
    clearInput("camera");
    clearInput("file");
    setDone(true);
    await onUploaded();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={t("invoices.uploadTitle")}>
      <h2 className="text-xl font-semibold">{t("invoices.uploadTitle")}</h2>
      <Field label={t("invoices.takePhoto")}>
        <input
          key={`camera-${inputKeys.camera}`}
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          onChange={(e) => choose("camera", e.target.files?.[0] ?? null)}
          className={fileInput}
        />
      </Field>
      <Field label={t("invoices.chooseFile")} hint={t("invoices.fileHint", { max })}>
        <input
          key={`file-${inputKeys.file}`}
          type="file"
          accept={`application/pdf,image/jpeg,image/png,${HEIC_ACCEPT}`}
          onChange={(e) => choose("file", e.target.files?.[0] ?? null)}
          className={fileInput}
        />
      </Field>
      {file && (
        <p className="[overflow-wrap:anywhere]">{t("invoices.chosen", { name: file.name })}</p>
      )}
      <ErrorAlert message={error} />
      {busy && <p role="status">{t("invoices.uploading")}</p>}
      {done && (
        <p role="status" className="rounded border border-green-300 bg-green-50 p-3 text-green-900">
          {t("invoices.uploaded")}
        </p>
      )}
      <Button type="submit" disabled={busy || !file}>
        {t("invoices.submit")}
      </Button>
    </form>
  );
}
