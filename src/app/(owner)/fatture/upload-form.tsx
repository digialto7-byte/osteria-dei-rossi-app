"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  FilePicker,
  SubHeading,
  SuccessNote,
} from "@/components/ui";
import { apiUpload } from "@/lib/api/client";
import { formatBytes } from "@/lib/format/bytes";
import { t } from "@/lib/i18n";
import { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";
import { MAX_HEIC_INPUT_BYTES, pickSizeError, reencodeForUpload } from "@/lib/upload/reencode";

type Source = "camera" | "file";

const HEIC_ACCEPT = ".heic,.heif,image/heic,image/heif";

/**
 * Picks a photo (phone camera) or a file and sends it to POST /api/invoices. The size checks here
 * only give a friendly message early (a HEIC is checked after it is re-encoded); the server
 * decides. An explicit "Carica" step keeps a wrong pick from becoming an invoice, since invoices
 * can never be deleted.
 */
export function UploadForm({ onUploaded }: { onUploaded: () => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<Source>("file");
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
    setSource(source);
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
    <Card>
      <form
        onSubmit={submit}
        className="flex flex-col gap-4"
        aria-label={t("invoices.uploadTitle")}
      >
        <SubHeading>{t("invoices.uploadTitle")}</SubHeading>
        <Field label={t("invoices.takePhoto")}>
          <FilePicker
            key={`camera-${inputKeys.camera}`}
            buttonLabel={t("file.takePhoto")}
            fileName={source === "camera" ? file?.name : null}
            accept="image/jpeg,image/png"
            capture="environment"
            onChange={(e) => choose("camera", e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label={t("invoices.chooseFile")} hint={t("invoices.fileHint", { max })}>
          <FilePicker
            key={`file-${inputKeys.file}`}
            fileName={source === "file" ? file?.name : null}
            accept={`application/pdf,image/jpeg,image/png,${HEIC_ACCEPT}`}
            onChange={(e) => choose("file", e.target.files?.[0] ?? null)}
          />
        </Field>
        <ErrorAlert message={error} />
        {busy && (
          <p role="status" className="text-ink-muted">
            {t("invoices.uploading")}
          </p>
        )}
        {done && <SuccessNote role="status">{t("invoices.uploaded")}</SuccessNote>}
        <Button type="submit" disabled={busy || !file}>
          {t("invoices.submit")}
        </Button>
      </form>
    </Card>
  );
}
