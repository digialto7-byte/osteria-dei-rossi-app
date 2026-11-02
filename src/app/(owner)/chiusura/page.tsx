"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Card, ErrorAlert, Heading, Muted, SubHeading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { paymentTypeLabel, receiptTypeLabel } from "@/lib/bill/bill-view";
import { businessDayTitle } from "@/lib/day-close/day-close-view";
import { t, tn } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import type { AppVsRegister, EnterDayCloseOutput } from "@/server/day-close/output";
import type { DayServices } from "@/server/services/output";
import { DayPicker } from "./day-picker";
import { DifferenceCard } from "./difference-card";
import { MissingReceipts } from "./missing-receipts";
import { RegisterForm } from "./register-form";
import { DayServicesCard } from "./services-card";

const FORBIDDEN = 403;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function Buckets({
  title,
  rows,
  label,
}: {
  title: string;
  rows: { type: string; total: number; tables: number }[];
  label: (type: string) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-bold tracking-wide text-ink-muted uppercase">{title}</h3>
      <ul className="flex flex-col gap-0.5 text-sm">
        {rows.map((row) => (
          <li key={row.type} className="tabular-nums">
            {t("dayClose.bucket", {
              label: label(row.type),
              amount: formatEuro(row.total),
              tables: tn("dayClose.tables", row.tables),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The end of the day (M21 plan §3.6) for owner and admin: the app's total for a business day against the register's, the difference, and
 * the tables closed without a receipt number. The page READS /api/reports/app-vs-register and WRITES POST /api/day-close; the reply of the
 * save carries the new report and replaces the screen's, so there is no second read. Every figure is the database's; nothing here adds,
 * compares or rounds money. A waiter or a chef gets one message and no form (the database refuses them too).
 */
function DayCloseScreen({ date }: { date: string | null }) {
  const router = useRouter();
  const [report, setReport] = useState<AppVsRegister | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [split, setSplit] = useState<DayServices | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const start = useRef(latestOnly()).current;
  const startSplit = useRef(latestOnly()).current;

  const load = useCallback(async () => {
    const isNewest = start();
    const query = date ? `?date=${date}` : "";
    const result = await apiJson<AppVsRegister>(`/api/reports/app-vs-register${query}`);
    if (!isNewest()) return;
    if (result.ok) {
      setLoadError(null);
      return setReport(result.data);
    }
    if (result.status === FORBIDDEN) return setForbidden(true);
    setLoadError(result.error.message);
  }, [date, start]);

  useEffect(() => {
    // Reading the report when the page opens or the day changes is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // The split by service (M25c) is read for the day the report names, after the report; a move re-reads it once.
  const businessDate = report?.businessDate ?? null;
  const loadSplit = useCallback(
    async (day: string) => {
      const isNewest = startSplit();
      const result = await apiJson<DayServices>(`/api/day-close/services?date=${day}`);
      if (!isNewest()) return;
      if (result.ok) {
        setSplitError(null);
        return setSplit(result.data);
      }
      setSplitError(result.error.message);
    },
    [startSplit],
  );

  useEffect(() => {
    if (businessDate === null) return;
    // Reading the split when the report arrives is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSplit(businessDate);
  }, [businessDate, loadSplit]);

  async function moveSession(sessionId: string, serviceKey: string | null) {
    const result = await apiJson(`/api/table-sessions/${sessionId}/service`, {
      method: "POST",
      body: { serviceKey },
    });
    if (!result.ok) return result.error.message;
    if (businessDate !== null) await loadSplit(businessDate);
    return null;
  }

  async function save(registerTotal: string) {
    if (!report) return;
    setSaving(true);
    setSaveError(null);
    const result = await apiJson<EnterDayCloseOutput>("/api/day-close", {
      method: "POST",
      body: { registerTotal, businessDate: report.businessDate },
    });
    setSaving(false);
    if (result.ok) return setReport(result.data.report);
    setSaveError(result.error.message);
  }

  const goTo = (next: string) => router.push(`/chiusura?data=${next}`);

  if (forbidden) {
    return (
      <>
        <Heading>{t("dayClose.heading")}</Heading>
        <ErrorAlert message={t("dayCloseError.forbidden")} />
      </>
    );
  }
  return (
    <>
      <Heading>{t("dayClose.heading")}</Heading>
      {report === null ? (
        loadError ? (
          <ErrorAlert message={loadError} />
        ) : (
          <Muted>{t("common.loading")}</Muted>
        )
      ) : (
        <>
          <p className="text-lg font-bold">{businessDayTitle(report.businessDate)}</p>
          <DayPicker date={report.businessDate} onChange={goTo} />
          <ErrorAlert message={loadError} />
          <Card className="flex flex-col gap-3">
            <SubHeading>{t("dayClose.app.heading")}</SubHeading>
            <p className="text-xl font-bold tabular-nums">
              {t("dayClose.app.total", {
                amount: formatEuro(report.app.total),
                tables: tn("dayClose.tables", report.app.tables),
                covers: tn("dayClose.covers", report.app.covers),
              })}
            </p>
            <Buckets
              title={t("bill.close.document")}
              rows={report.app.byReceiptType}
              label={(type) => receiptTypeLabel(type as "scontrino" | "fattura")}
            />
            <Buckets
              title={t("bill.close.payment")}
              rows={report.app.byPaymentType}
              label={(type) => paymentTypeLabel(type as "cash" | "card" | "other")}
            />
          </Card>
          {split ? (
            <DayServicesCard data={split} onMove={moveSession} />
          ) : (
            <ErrorAlert message={splitError} />
          )}
          <Card>
            <RegisterForm busy={saving} error={saveError} onSave={(total) => void save(total)} />
          </Card>
          <DifferenceCard register={report.register} difference={report.difference} />
          <MissingReceipts rows={report.missingReceipts} />
          {report.openTables.count > 0 && (
            <p>
              {t("dayClose.open", {
                count: report.openTables.count,
                amount: formatEuro(report.openTables.provisionalTotal),
              })}
            </p>
          )}
          {report.lateOps.count > 0 && (
            <div className="flex flex-col gap-1">
              <p>{t("dayClose.lateOps", { count: report.lateOps.count })}</p>
              <p className="text-sm text-ink-muted">{t("dayClose.lateOps.hint")}</p>
            </div>
          )}
        </>
      )}
    </>
  );
}

function DayCloseRoute() {
  const data = useSearchParams().get("data");
  return <DayCloseScreen key={data ?? "today"} date={data && DATE.test(data) ? data : null} />;
}

export default function DayClosePage() {
  return (
    <Suspense fallback={<Muted>{t("common.loading")}</Muted>}>
      <DayCloseRoute />
    </Suspense>
  );
}
