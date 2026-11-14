"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  dangerNoteClass,
  Field,
  FilePicker,
  LedgerList,
  LedgerRow,
  linkClass,
  SubHeading,
  SuccessNote,
} from "@/components/ui";
import { apiUpload } from "@/lib/api/client";
import { formatBytes } from "@/lib/format/bytes";
import { t } from "@/lib/i18n";
import { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";
import {
  describeUploadError,
  describeUploadSuccess,
  eInvoiceChip,
  isEInvoiceName,
  type UploadErrorView,
  type UploadReply,
  type UploadSuccess,
} from "@/lib/invoices/upload-result";
import { MAX_HEIC_INPUT_BYTES, pickSizeError, reencodeForUpload } from "@/lib/upload/reencode";

type Source = "camera" | "file";

const HEIC_ACCEPT = ".heic,.heif,image/heic,image/heif";
// E-invoice files (P2-7): the extensions and the types a phone or a desktop may send for them. The server reads the content.
const EINVOICE_ACCEPT = ".xml,.p7m,application/xml,text/xml,application/pkcs7-mime";

type Result = { kind: "error"; view: UploadErrorView } | { kind: "success"; view: UploadSuccess };

/** A refusal drawn from a message only (a check made on the phone before any request). */
const localError = (message: string): Result => ({
  kind: "error",
  view: { lead: null, message, rows: [], openInvoiceId: null },
});

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
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const max = formatBytes(MAX_UPLOAD_BYTES);
  const tooBig = (name: string) =>
    isEInvoiceName(name) ? t("invoices.tooBigXml", { max }) : t("invoices.tooBig", { max });

  useEffect(() => {
    // The result is announced by its role; focus goes to it too, so a keyboard or screen-reader user lands on it.
    if (result) resultRef.current?.focus();
  }, [result]);

  // A file input cannot be cleared from React state, so a new key remounts it empty.
  const clearInput = (source: Source) =>
    setInputKeys((keys) => ({ ...keys, [source]: keys[source] + 1 }));

  function choose(source: Source, picked: File | null) {
    setResult(null);
    const sizeError = picked ? pickSizeError(picked) : null;
    if (picked && sizeError) {
      clearInput(source);
      setFile(null);
      setResult(
        localError(
          sizeError === "heicTooBig"
            ? t("invoices.heicTooBig", { max: formatBytes(MAX_HEIC_INPUT_BYTES) })
            : tooBig(picked.name),
        ),
      );
      return;
    }
    setFile(picked);
    setSource(source);
    if (picked) clearInput(source === "camera" ? "file" : "camera");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setResult(null);
    const prepared = await reencodeForUpload(file);
    if (!prepared.ok) {
      setBusy(false);
      return setResult(localError(prepared.message));
    }
    if (prepared.file.size > MAX_UPLOAD_BYTES) {
      setBusy(false);
      return setResult(localError(tooBig(prepared.file.name)));
    }
    const body = new FormData();
    body.append("file", prepared.file);
    const reply = await apiUpload<UploadReply>("/api/invoices", body);
    setBusy(false);
    if (!reply.ok) {
      return setResult({
        kind: "error",
        view: describeUploadError(reply.error, prepared.file.name),
      });
    }
    setFile(null);
    clearInput("camera");
    clearInput("file");
    setResult({ kind: "success", view: describeUploadSuccess(reply.data) });
    await onUploaded();
  }

  const chip = source === "file" && file ? eInvoiceChip(file.name) : null;
  return (
    <Card>
      <form
        method="post"
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
            accept={`application/pdf,image/jpeg,image/png,${HEIC_ACCEPT},${EINVOICE_ACCEPT}`}
            onChange={(e) => choose("file", e.target.files?.[0] ?? null)}
          />
        </Field>
        {chip && (
          <Badge tone="info" data-testid="e-invoice-chip">
            {chip}
          </Badge>
        )}
        {busy && (
          <p role="status" className="text-ink-muted">
            {file && isEInvoiceName(file.name)
              ? t("invoices.uploadingXml")
              : t("invoices.uploading")}
          </p>
        )}
        <Button type="submit" disabled={busy || !file} aria-busy={busy}>
          {t("invoices.submit")}
        </Button>
        {result && (
          <div
            ref={resultRef}
            tabIndex={-1}
            data-testid="upload-result"
            className="flex flex-col gap-3 outline-none"
          >
            <UploadResult result={result} />
          </div>
        )}
      </form>
    </Card>
  );
}

/** The note, or the alert, under "Carica". The words come from `describeUploadSuccess` and `describeUploadError`. */
function UploadResult({ result }: { result: Result }) {
  if (result.kind === "error") {
    const { lead, message, rows, openInvoiceId } = result.view;
    return (
      <>
        <div role="alert" className={`${dangerNoteClass} flex flex-col gap-2`}>
          {lead && <p>{lead}</p>}
          <p>{message}</p>
          {rows.length > 0 && (
            <ul className="list-disc pl-5">
              {rows.map((row, index) => (
                <li key={index} className="[overflow-wrap:anywhere]">
                  {row}
                </li>
              ))}
            </ul>
          )}
        </div>
        {openInvoiceId && (
          <Link href={`/fatture/${openInvoiceId}`} className={`${linkClass} self-start`}>
            {t("invoices.xml.openInvoice")}
          </Link>
        )}
      </>
    );
  }
  const { view } = result;
  if (view.kind === "document") {
    return <SuccessNote role="status">{t("invoices.uploaded")}</SuccessNote>;
  }
  if (view.kind === "xml-many") {
    return (
      <>
        <SuccessNote role="status">{view.intro}</SuccessNote>
        <LedgerList>
          {view.rows.map((row) => (
            <LedgerRow key={row.id}>
              <Link
                href={row.href}
                className="-mx-2 flex min-h-tap flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-3 hover:bg-sunk"
              >
                <span className="num min-w-0 flex-1 font-bold [overflow-wrap:anywhere]">
                  {row.title}
                </span>
                <Badge tone={row.badge.tone}>{row.badge.text}</Badge>
              </Link>
            </LedgerRow>
          ))}
        </LedgerList>
      </>
    );
  }
  return (
    <>
      <SuccessNote role="status">{view.text}</SuccessNote>
      <Link href={view.href} className={`${linkClass} self-start`}>
        {view.linkLabel}
      </Link>
    </>
  );
}
