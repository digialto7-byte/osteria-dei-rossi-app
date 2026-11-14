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
import { formatCount, stateBadge } from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import {
  batchHref,
  formatShortDateTime,
  lotCodeText,
  portionsShort,
  qtyText,
} from "@/lib/trace/trace-view";
import type { TraceBatch, TraceBatchChef } from "@/server/trace/output";
import { FACT_LIST_CLASS, Fact, PlatesSection, ReachedLot, infoNoteClass } from "../../trace-parts";
import { useTraceRead } from "../../use-trace-read";

/**
 * One production batch, backward and forward (P2-2 spec §5): the deliveries and suppliers that went into it, then where its portions went. Reads
 * /api/trace/batches/:id. A split part shows the ingredients of the batch it was split from. A slice made when the stock said zero is "Senza lotto".
 */
export default function BatchTracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, message } = useTraceRead<TraceBatch | TraceBatchChef>(`/api/trace/batches/${id}`);
  const back = <BackLink href={`/produzione/${id}`}>{t("production.back")}</BackLink>;
  if (!data) {
    return (
      <>
        {back}
        <ErrorAlert message={message} />
        {!message && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }
  const { batch, portions } = data;
  const state = stateBadge(batch.state);
  const rows: [string, number][] = [
    [t("trace.p.sold"), portions.sold],
    [t("trace.p.wasted"), portions.wasted],
    [t("trace.p.staffMeal"), portions.staffMeal],
    [t("trace.p.counted"), portions.counted],
    [t("trace.p.splitOut"), portions.splitOut],
    [t("trace.p.remaining"), portions.remaining],
  ];
  return (
    <>
      {back}
      <Heading>{batch.recipeName}</Heading>
      <Card className="flex flex-col gap-3">
        {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
        <dl className={FACT_LIST_CLASS}>
          <Fact label={t("batch.detail.lot")}>{lotCodeText(batch.lotCode)}</Fact>
          <Fact label={t("trace.f.produced")}>{formatShortDateTime(batch.producedAt)}</Fact>
          <Fact label={t("trace.f.useBy")}>{formatShortDateTime(batch.useBy)}</Fact>
          <Fact label={t("trace.f.portions")}>{portionsShort(batch.portionsInitial)}</Fact>
        </dl>
      </Card>

      <section className="flex flex-col gap-2">
        <SubHeading>{t("trace.from.title")}</SubHeading>
        {batch.splitFrom ? (
          <p className={infoNoteClass}>
            {t("trace.inherited")}{" "}
            <Link href={batchHref(batch.root.batchId)} className={`${linkClass} num`}>
              {lotCodeText(batch.root.lotCode)}
            </Link>{" "}
            ›
          </p>
        ) : null}
        <LedgerList>
          {data.inputs.map((input, index) =>
            input.lot ? (
              <ReachedLot
                key={`${input.lot.lotId}-${index}`}
                lot={input.lot}
                lead={input.ingredient.name}
                qty={qtyText(input.qty, input.unit)}
              />
            ) : (
              <LedgerRow key={`none-${index}`} className="flex flex-col gap-1 py-3">
                <span className="font-bold">{t("stock.noLot")}</span>
                <p className="num text-sm text-ink-muted">
                  {input.ingredient.name} · {qtyText(input.qty, input.unit)} ·{" "}
                  {t("trace.input.noLot")}
                </p>
              </LedgerRow>
            ),
          )}
        </LedgerList>
      </section>

      <SubHeading>{t("trace.where")}</SubHeading>
      <dl className={FACT_LIST_CLASS}>
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="num text-right">{formatCount(value)}</dd>
          </div>
        ))}
      </dl>
      <PlatesSection plates={data.plates} truncated={data.platesTruncated} />
    </>
  );
}
