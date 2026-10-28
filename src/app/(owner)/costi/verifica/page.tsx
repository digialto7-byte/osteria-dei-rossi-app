"use client";

import { BackLink } from "@/components/back-link";
import { useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert, Field, FilePicker, Heading } from "@/components/ui";
import { useMe } from "@/components/use-me";
import { apiJson, detailList, type ApiErrorBody } from "@/lib/api/client";
import { canReadCosts } from "@/lib/costing/cost-view";
import { t } from "@/lib/i18n";
import type { CostCheckResponse } from "@/server/costing/cost-check-run";
import { CostCheckErrorList, CostCheckResultView } from "./cost-check-result";

const FORBIDDEN = 403;

/** Gate 1: the chef's sheet (CSV) against the app's food cost. Reads and writes nothing but /api/admin/cost-check. */
export default function CostCheckPage() {
  const role = useMe().me?.user.role ?? null;
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<CostCheckResponse | null>(null);
  const [failure, setFailure] = useState<{ status: number; error: ApiErrorBody } | null>(null);
  const [busy, setBusy] = useState(false);

  async function chooseFile(file: File | undefined) {
    setFileName(file?.name ?? null);
    // The file is read here and sent as JSON text, so the request follows the API's JSON-only rule.
    if (file) setCsv(await file.text());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    setFailure(null);
    const reply = await apiJson<CostCheckResponse>("/api/admin/cost-check", {
      method: "POST",
      body: { format: "csv", csv },
    });
    setBusy(false);
    if (reply.ok) setResult(reply.data);
    else setFailure({ status: reply.status, error: reply.error });
  }

  return (
    <>
      {role !== null && canReadCosts(role) && (
        <BackLink href="/costi">{t("costs.recipe.back")}</BackLink>
      )}
      <Heading>{t("costs.check.title")}</Heading>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("costs.check.sheet")} hint={t("costs.check.hint")}>
            <FilePicker
              fileName={fileName}
              accept=".csv,text/csv"
              onChange={(e) => void chooseFile(e.target.files?.[0])}
            />
          </Field>
          <Field label={t("costs.check.paste")}>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={6}
              spellCheck={false}
              className="num min-h-tap w-full rounded-lg border border-rule-strong bg-surface p-3 text-base text-ink"
            />
          </Field>
          <div>
            <Button type="submit" disabled={busy || csv.trim() === ""}>
              {t("costs.check.submit")}
            </Button>
          </div>
        </form>
      </Card>
      {failure && (
        <>
          <ErrorAlert
            message={
              failure.status === FORBIDDEN ? t("costError.forbidden") : failure.error.message
            }
          />
          {detailList(failure.error.details) && (
            <CostCheckErrorList details={detailList(failure.error.details)!} />
          )}
        </>
      )}
      {result && <CostCheckResultView result={result} />}
    </>
  );
}
