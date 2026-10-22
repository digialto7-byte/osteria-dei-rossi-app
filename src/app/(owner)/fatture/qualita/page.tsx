"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorAlert, Field, Heading, linkClass, Muted, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { ExtractionQualityReport } from "@/server/reports/extraction-quality";
import { QualitySummary } from "./quality-summary";

interface Answer {
  period: { from: string; to: string };
  report: ExtractionQualityReport;
}

/** The extraction-quality report for a period. The server picks the default (last 30 days, Rome time). */
export default function QualityPage() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: { from: string; to: string }) => {
    const query = new URLSearchParams(
      Object.entries(range).filter(([, value]) => value !== ""),
    ).toString();
    const result = await apiJson<Answer>(
      `/api/reports/extraction-quality${query ? `?${query}` : ""}`,
    );
    if (result.ok) {
      setAnswer(result.data);
      setFrom(result.data.period.from);
      setTo(result.data.period.to);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    // The first load uses the server's default period.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ from: "", to: "" });
  }, [load]);

  return (
    <>
      <Heading>{t("quality.title")}</Heading>
      <Card>
        <form
          aria-label={t("quality.period")}
          className="flex flex-col gap-4"
          onSubmit={(event) => event.preventDefault()}
        >
          <Field label={t("quality.from")}>
            <TextInput
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                if (event.target.value && to) void load({ from: event.target.value, to });
              }}
            />
          </Field>
          <Field label={t("quality.to")}>
            <TextInput
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                if (from && event.target.value) void load({ from, to: event.target.value });
              }}
            />
          </Field>
        </form>
      </Card>
      <ErrorAlert message={error} />
      {answer ? (
        <QualitySummary report={answer.report} />
      ) : (
        !error && <Muted>{t("common.loading")}</Muted>
      )}
      <Link href="/fatture" className={`${linkClass} self-start`}>
        <span aria-hidden="true" className="inline-block">
          ‹
        </span>
        {t("invoices.backToList")}
      </Link>
    </>
  );
}
