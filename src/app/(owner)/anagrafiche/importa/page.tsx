"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  FilePicker,
  Heading,
  linkClass,
  Select,
  SuccessNote,
} from "@/components/ui";
import { apiJson, type ApiErrorBody } from "@/lib/api/client";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import type { RecipeImportResult } from "@/server/recipes/import";
import { INITIAL_DRY_RUN, RecipeImportOptions, RecipePreview } from "./recipe-preview";

/** The Italian text for an error code from the import API; unknown codes are shown as they are. */
function importErrorText(code: string | number | undefined): string {
  for (const prefix of ["importError", "recipeCode"]) {
    const key = `${prefix}.${code}`;
    if (isMessageKey(key)) return t(key as MessageKey);
  }
  return String(code ?? "");
}

type Kind = "suppliers" | "ingredients" | "recipes";

const TEMPLATES: Record<Kind, string> = {
  suppliers: "nome; partita_iva; giorni_pagamento",
  ingredients: "nome; unita_base; categoria; a_magazzino; allergeni; giorni_conservazione",
  recipes: t("import.recipesTemplate"),
};

// The rule under the file picker: blank cells keep the stored value, and what the allergen cell means.
const RULES: Record<Kind, string> = {
  suppliers: t("import.blankRule"),
  ingredients: `${t("import.blankRule")} ${t("import.allergensRule")}`,
  recipes: t("import.recipesRule"),
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
  const [dryRun, setDryRun] = useState(INITIAL_DRY_RUN);
  const [recipeResult, setRecipeResult] = useState<RecipeImportResult | null>(null);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(asPreview: boolean) {
    if (!file) return;
    setBusy(true);
    setCounts(null);
    setRecipeResult(null);
    setError(null);
    // The file is read here and sent as JSON text, so the upload follows the API's JSON-only rule.
    const csv = await file.text();
    if (kind === "recipes") {
      const result = await apiJson<RecipeImportResult>("/api/admin/import/recipes", {
        method: "POST",
        body: { format: "csv", csv, dryRun: asPreview },
      });
      setBusy(false);
      if (result.ok) setRecipeResult(result.data);
      else setError(result.error);
      return;
    }
    const result = await apiJson<Counts>(`/api/admin/import/${kind}`, {
      method: "POST",
      body: { format: "csv", csv },
    });
    setBusy(false);
    if (result.ok) setCounts(result.data);
    else setError(result.error);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(kind === "recipes" && dryRun);
  }

  function changeKind(next: Kind) {
    setKind(next);
    setCounts(null);
    setRecipeResult(null);
    setError(null);
  }

  return (
    <>
      <Heading>{t("import.title")}</Heading>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("import.kind")} hint={t("import.template", { columns: TEMPLATES[kind] })}>
            <Select value={kind} onChange={(e) => changeKind(e.target.value as Kind)}>
              <option value="suppliers">{t("nav.suppliers")}</option>
              <option value="ingredients">{t("nav.ingredients")}</option>
              <option value="recipes">{t("import.kind.recipes")}</option>
            </Select>
          </Field>
          <Field label={t("import.file")} hint={RULES[kind]}>
            <FilePicker
              fileName={file?.name}
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </Field>
          {kind === "recipes" && <RecipeImportOptions dryRun={dryRun} onChange={setDryRun} />}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant={recipeResult?.dryRun ? "secondary" : "primary"}
              disabled={busy || !file}
            >
              {kind === "recipes" && dryRun ? t("import.preview") : t("import.submit")}
            </Button>
            {kind === "recipes" && (
              <a href="/api/admin/export/recipes" download="ricette.json" className={linkClass}>
                {t("import.exportRecipes")}
              </a>
            )}
          </div>
        </form>
      </Card>
      {recipeResult && (
        <RecipePreview result={recipeResult} busy={busy} onConfirm={() => void send(false)} />
      )}
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
