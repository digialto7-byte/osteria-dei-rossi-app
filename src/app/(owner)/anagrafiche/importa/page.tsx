"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  fileInputClass,
  Heading,
  Select,
  SuccessNote,
} from "@/components/ui";
import { apiJson, type ApiErrorBody } from "@/lib/api/client";
import { isMessageKey, t } from "@/lib/i18n";

/** The Italian text for an error code from the import API; unknown codes are shown as they are. */
function importErrorText(code: string | number | undefined): string {
  const key = `importError.${code}`;
  return isMessageKey(key) ? t(key) : String(code ?? "");
}

type Kind = "suppliers" | "ingredients";

const TEMPLATES: Record<Kind, string> = {
  suppliers: "nome; partita_iva; giorni_pagamento",
  ingredients: "nome; unita_base; categoria; a_magazzino; allergeni; giorni_conservazione",
};

interface Counts {
  created: number;
  updated: number;
  unchanged: number;
}

export default function ImportPage() {
  const [kind, setKind] = useState<Kind>("suppliers");
  const [file, setFile] = useState<File | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setCounts(null);
    setError(null);
    // The file is read here and sent as JSON text, so the upload follows the API's JSON-only rule.
    const result = await apiJson<Counts>(`/api/admin/import/${kind}`, {
      method: "POST",
      body: { format: "csv", csv: await file.text() },
    });
    setBusy(false);
    if (result.ok) setCounts(result.data);
    else setError(result.error);
  }

  return (
    <>
      <Heading>{t("import.title")}</Heading>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("import.kind")} hint={t("import.template", { columns: TEMPLATES[kind] })}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="suppliers">{t("nav.suppliers")}</option>
              <option value="ingredients">{t("nav.ingredients")}</option>
            </Select>
          </Field>
          <Field label={t("import.file")} hint={t("import.blankRule")}>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className={fileInputClass}
              required
            />
          </Field>
          <Button type="submit" disabled={busy || !file}>
            {t("import.submit")}
          </Button>
        </form>
      </Card>
      {counts && (
        <SuccessNote role="status">
          <span className="num">
            {t("import.result", {
              created: counts.created,
              updated: counts.updated,
              unchanged: counts.unchanged,
            })}
          </span>
        </SuccessNote>
      )}
      <ErrorAlert message={error?.message ?? null} />
      {error?.details && (
        <ul className="flex list-disc flex-col gap-1 pl-6 text-danger marker:text-danger">
          {error.details.map((detail) => (
            <li key={`${detail.row}-${detail.field}`}>
              {t("import.rowError", {
                row: detail.row ?? "",
                field: detail.field ?? "",
                code: importErrorText(detail.code),
              })}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
