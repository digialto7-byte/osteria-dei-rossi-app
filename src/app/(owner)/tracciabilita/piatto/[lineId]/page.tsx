"use client";

import Link from "next/link";
import { use } from "react";
import { BackLink } from "@/components/back-link";
import {
  Badge,
  ErrorAlert,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  SubHeading,
  linkClass,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { batchHref, lineMeta, lotCodeText, qtyText } from "@/lib/trace/trace-view";
import type { TraceOrderLine, TraceOrderLineChef } from "@/server/trace/output";
import { ReachedLot } from "../../trace-parts";
import { useTraceRead } from "../../use-trace-read";

const VOIDED = "voided";

/**
 * One served plate, backward (P2-2 spec §5): the preparations it came from, the raw ingredients used directly and the distinct lots and suppliers
 * behind them. Reads /api/trace/lines/:id. A line that was never sent to the kitchen has nothing to trace and says so. No guest data: the table's
 * name and the times only.
 */
export default function LineTracePage({ params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = use(params);
  const { data, message } = useTraceRead<TraceOrderLine | TraceOrderLineChef>(
    `/api/trace/lines/${lineId}`,
  );
  if (!data) {
    return (
      <>
        <BackLink href="/tracciabilita?da=piatto">{t("trace.back")}</BackLink>
        <ErrorAlert message={message} />
        {!message && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }
  const { line } = data;
  const day = encodeURIComponent(line.businessDate);
  return (
    <>
      <BackLink href={`/tracciabilita?da=piatto&giorno=${day}`}>{t("trace.back")}</BackLink>
      <Heading>{line.menuItemName}</Heading>
      <div className="flex flex-wrap items-center gap-2">
        {line.firedAt ? (
          <p className="num text-ink-muted">{lineMeta({ ...line, firedAt: line.firedAt })}</p>
        ) : null}
        {line.state === VOIDED ? <Badge tone="neutral">{t("trace.line.voided")}</Badge> : null}
      </div>
      {line.firedAt === null ? (
        <Muted>{t("trace.line.draft")}</Muted>
      ) : (
        <>
          {data.batches.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SubHeading>{t("trace.line.used")}</SubHeading>
              <LedgerList>
                {data.batches.map((batch) => (
                  <LedgerRow key={batch.batchId} className="flex flex-wrap items-center gap-2 py-1">
                    <Link
                      href={batchHref(batch.batchId)}
                      className={`${linkClass} num [overflow-wrap:anywhere]`}
                    >
                      {batch.recipeName} · {lotCodeText(batch.lotCode)} ›
                    </Link>
                    {batch.reversed ? (
                      <Badge tone="neutral">{t("trace.line.reversed")}</Badge>
                    ) : null}
                  </LedgerRow>
                ))}
              </LedgerList>
            </section>
          ) : null}
          {data.rawDirect.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SubHeading>{t("trace.line.direct")}</SubHeading>
              <LedgerList>
                {data.rawDirect.map((row, index) =>
                  row.lot ? (
                    <ReachedLot
                      key={`${row.lot.lotId}-${index}`}
                      lot={row.lot}
                      lead={row.ingredient.name}
                      qty={qtyText(row.qty, row.unit)}
                    />
                  ) : (
                    <LedgerRow key={`none-${index}`} className="py-3">
                      <span className="font-bold">{t("stock.noLot")}</span>
                      <p className="num text-sm text-ink-muted">
                        {row.ingredient.name} · {qtyText(row.qty, row.unit)}
                      </p>
                    </LedgerRow>
                  ),
                )}
              </LedgerList>
            </section>
          ) : null}
          {data.lots.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SubHeading>{t("trace.line.lots")}</SubHeading>
              <LedgerList>
                {data.lots.map((lot) => (
                  <ReachedLot key={lot.lotId} lot={lot} lead={lot.ingredient.name} />
                ))}
              </LedgerList>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
