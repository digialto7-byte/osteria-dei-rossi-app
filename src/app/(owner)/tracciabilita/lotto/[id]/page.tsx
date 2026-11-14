"use client";

import Link from "next/link";
import { use } from "react";
import { BackLink } from "@/components/back-link";
import {
  Badge,
  Card,
  ErrorAlert,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  SubHeading,
  linkClass,
} from "@/components/ui";
import { stateBadge } from "@/lib/batches/batch-view";
import { t, tn } from "@/lib/i18n";
import {
  batchHref,
  formatShortDate,
  formatShortDateTime,
  lotCodeText,
  outcomeText,
  platesText,
  portionsShort,
  qtyText,
} from "@/lib/trace/trace-view";
import type { TraceLot, TraceLotChef } from "@/server/trace/output";
import {
  FACT_LIST_CLASS,
  Fact,
  InvoiceLink,
  PlatesSection,
  infoNoteClass,
} from "../../trace-parts";
import { useTraceRead } from "../../use-trace-read";

/**
 * One supplier lot, forward (P2-2 spec §4): what it was, where it went, then the detail (production batches, plates served, voids). Reads
 * /api/trace/lots/:id. Owner and admin also get the invoice and the supplier's article in the reply; the chef's reply has neither, and nothing
 * here asks for them. Where the stock did not know (no lot code, a batch made on an empty shelf) the page says so.
 */
export default function LotTracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, message } = useTraceRead<TraceLot | TraceLotChef>(`/api/trace/lots/${id}`);
  const back = <BackLink href="/tracciabilita">{t("trace.back")}</BackLink>;
  if (!data) {
    return (
      <>
        {back}
        <ErrorAlert message={message} />
        {!message && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }
  const { lot, raw } = data;
  const purchase = "purchase" in lot ? lot.purchase : null;
  const invoice = "invoice" in lot ? lot.invoice : null;
  const unit = raw.unit;
  const where: [string, number][] = [
    [t("trace.raw.intoBatches"), raw.intoBatches],
    [t("trace.raw.intoPlates"), raw.intoPlates],
    [t("trace.raw.wasted"), raw.wasted],
    [t("trace.raw.counted"), raw.counted],
    [t("trace.raw.onHand"), raw.onHand],
  ];
  return (
    <>
      {back}
      <Heading>{lot.ingredient.name}</Heading>
      <Card className="flex flex-col gap-3">
        <dl className={FACT_LIST_CLASS}>
          <Fact label={t("batch.detail.lot")}>{lotCodeText(lot.lotCode)}</Fact>
          <Fact label={t("trace.f.supplier")}>{lot.supplier.name}</Fact>
          <Fact label={t("trace.f.delivery")}>{formatShortDate(lot.receivedOn)}</Fact>
          {lot.expiry ? (
            <Fact label={t("trace.f.expiry")}>{formatShortDate(lot.expiry)}</Fact>
          ) : null}
          <Fact label={t("trace.f.received")}>
            {qtyText(lot.qtyReceived, lot.unit)} · {lot.location.name}
          </Fact>
          {purchase ? (
            <Fact label={t("trace.f.article")}>
              {[purchase.supplierCode, purchase.description].filter(Boolean).join(" · ")}
            </Fact>
          ) : null}
        </dl>
        {invoice ? <InvoiceLink invoice={invoice} /> : null}
      </Card>
      {data.gaps.lotCodeMissing || data.gaps.unlottedSameIngredientBatches > 0 ? (
        <div role="status" className={`${infoNoteClass} flex flex-col gap-1`}>
          <p className="font-bold">{t("trace.gaps.title")}</p>
          {data.gaps.lotCodeMissing ? <p>{t("trace.gaps.lotCode")}</p> : null}
          {data.gaps.unlottedSameIngredientBatches > 0 ? (
            <p>
              {tn("trace.gaps.unlotted", data.gaps.unlottedSameIngredientBatches)
                .replace("{ingredient}", lot.ingredient.name)
                .replace("{date}", formatShortDate(lot.receivedOn))}
            </p>
          ) : null}
        </div>
      ) : null}

      <SubHeading>{t("trace.where")}</SubHeading>
      <dl className={FACT_LIST_CLASS}>
        {where.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="num text-right">{qtyText(value, unit)}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-2">
        <SubHeading>{t("trace.batches", { count: data.batches.length })}</SubHeading>
        {data.batches.length === 0 ? (
          <Muted>{t("trace.batches.none")}</Muted>
        ) : (
          <LedgerList>
            {data.batches.map((batch) => {
              const state = stateBadge(batch.state);
              const outcome = {
                initial: portionsShort(batch.portionsInitial),
                outcome: outcomeText({
                  sold: batch.portions.sold,
                  wasted: batch.portions.wasted,
                  remaining: batch.portions.remaining,
                }),
              };
              const when = formatShortDateTime(batch.producedAt);
              return (
                <LedgerRow key={batch.batchId} className="flex flex-col gap-1 py-3">
                  <Link
                    href={batchHref(batch.batchId)}
                    className={`${linkClass} num [overflow-wrap:anywhere]`}
                  >
                    {batch.recipeName} · {lotCodeText(batch.lotCode)} ›
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    {batch.splitFrom ? (
                      <Badge tone="neutral">
                        {t("trace.splitFrom", { lot: lotCodeText(batch.splitFrom.lotCode) })}
                      </Badge>
                    ) : null}
                    {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
                  </div>
                  <p className="num text-sm text-ink-muted [overflow-wrap:anywhere]">
                    {batch.qtyFromLot === null
                      ? t("trace.batches.lineChild", { when, ...outcome })
                      : t("trace.batches.line", {
                          when,
                          qty: qtyText(batch.qtyFromLot, unit),
                          ...outcome,
                        })}
                  </p>
                </LedgerRow>
              );
            })}
          </LedgerList>
        )}
        {data.batchesTruncated ? (
          <Muted>{t("trace.truncated.more", { count: data.batches.length })}</Muted>
        ) : null}
      </section>

      <PlatesSection
        plates={data.plates}
        truncated={data.platesTruncated}
        none={t("trace.plates.none")}
      />

      {data.voided.lines > 0 ? (
        <section className="flex flex-col gap-2">
          <SubHeading>{t("trace.voided")}</SubHeading>
          <p className="num">
            {platesText(data.voided.lines)} ({portionsShort(data.voided.portions)})
          </p>
        </section>
      ) : null}
    </>
  );
}
