"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import {
  Card,
  ErrorAlert,
  Heading,
  LedgerList,
  LedgerRow,
  linkClass,
  Muted,
  SubHeading,
  SuccessNote,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import {
  amountText,
  creditText,
  dueLine,
  historyLine,
  invoiceLine,
  statusView,
} from "@/lib/payables/payable-view";
import { formatCalendarDate } from "@/lib/time/format";
import type { PatchPayableBody } from "@/server/payables/schemas";
import type { PayableDetail } from "@/server/payables/types";
import { DETAIL_LIST_CLASS, Detail } from "../../fatture/detail";
import { ReverseForm } from "./reverse-form";
import { StatusForm } from "./status-form";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** One payable: the facts, the status form the server allows, and the history. Reads /api/payables/:id only. */
export default function PayablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<PayableDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await apiJson<PayableDetail>(`/api/payables/${id}`);
    if (result.ok) return setDetail(result.data);
    if (result.status === FORBIDDEN) setMessage(t("payables.forbidden"));
    else if (result.status === NOT_FOUND) setMessage(t("payables.notFound"));
    else setError(result.error.message);
  }, [id]);

  useEffect(() => {
    // Loading the payable when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save(body: PatchPayableBody) {
    setBusy(true);
    setError(null);
    setSaved(null);
    const result = await apiJson<{ changed: boolean }>(`/api/payables/${id}`, {
      method: "PATCH",
      body,
    });
    if (!result.ok) {
      setBusy(false);
      return setError(result.error.message);
    }
    await load();
    setBusy(false);
    setSaved(
      !result.data.changed
        ? t("payables.saved.unchanged")
        : body.reversal
          ? t("payables.saved.reversed")
          : body.status === "paid"
            ? t("payables.saved.paid")
            : t("payables.saved.status"),
    );
  }

  if (!detail) {
    return (
      <>
        <ErrorAlert message={message ?? error} />
        {!message && !error && <Muted>{t("common.loading")}</Muted>}
        <BackLink />
      </>
    );
  }

  const { payable } = detail;
  const status = statusView(payable.status, payable.paidOn);
  return (
    <>
      <Heading>{payable.supplierName}</Heading>
      <Card className="py-1">
        <dl className={DETAIL_LIST_CLASS}>
          <dt className="pr-4 text-ink-muted">{t("payables.fact.invoice")}</dt>
          <dd data-testid="fact-invoice" className="num">
            <Link href={`/fatture/${payable.invoiceId}`} className={linkClass}>
              {payable.invoiceNumber ?? t("payables.noNumber")}
            </Link>
          </dd>
          <Detail
            label={t("payables.fact.invoiceDate")}
            value={payable.invoiceDate ? formatCalendarDate(payable.invoiceDate) : null}
            testId="fact-invoice-date"
            numeric
          />
          <Detail
            label={t("payables.fact.dueDate")}
            value={`${formatCalendarDate(payable.dueDate)} (${t(`payables.fact.dueSource.${payable.dueDateSource}`)})`}
            testId="fact-due-date"
            numeric
          />
          <Detail
            label={t("payables.fact.gross")}
            value={amountText(payable.grossAmount)}
            testId="fact-gross"
            numeric
          />
          <Detail
            label={t("payables.fact.credits")}
            value={creditText(payable.creditedAmount)}
            testId="fact-credits"
            numeric
          />
          <Detail
            label={t("payables.fact.toPay")}
            value={amountText(payable.amount)}
            testId="fact-amount"
            numeric
          />
          <Detail label={t("payables.fact.status")} value={status.label} testId="fact-status" />
          <Detail
            label={t("payables.fact.paidOn")}
            value={payable.paidOn ? formatCalendarDate(payable.paidOn) : null}
            testId="fact-paid-on"
            numeric
          />
        </dl>
        <p className="num border-t border-rule py-3 text-sm text-ink-muted">
          {invoiceLine(payable.invoiceNumber, payable.invoiceDate)} · {dueLine(payable)}
        </p>
      </Card>
      {saved && <SuccessNote role="status">{saved}</SuccessNote>}
      <ErrorAlert message={error} />
      <StatusForm
        allowed={detail.allowedStatuses}
        today={detail.today}
        busy={busy}
        onSubmit={save}
      />
      {detail.canReversePayment && (
        <ReverseForm
          busy={busy}
          onSubmit={(reason) => save({ status: "open", reversal: true, reason })}
        />
      )}
      <SubHeading>{t("payables.history.title")}</SubHeading>
      <LedgerList>
        {detail.history.map((entry, index) => (
          <LedgerRow key={`${entry.at}-${index}`} className="flex flex-col gap-1 py-3">
            <p className="num text-sm [overflow-wrap:anywhere]">{historyLine(entry)}</p>
            {entry.reason && (
              <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">
                {t("payables.history.reason", { reason: entry.reason })}
              </p>
            )}
          </LedgerRow>
        ))}
      </LedgerList>
      <BackLink />
    </>
  );
}

function BackLink() {
  return (
    <Link href="/pagamenti" className={`${linkClass} self-start`}>
      {t("payables.back")}
    </Link>
  );
}
