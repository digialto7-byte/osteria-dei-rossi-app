"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Badge, Card, ErrorAlert, Heading, linkClass, Muted, SubHeading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { incompleteNotes, plateFigures, statusView } from "@/lib/costing/cost-view";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import type { RecipeCost } from "@/server/costing/types";
import { Detail, DETAIL_LIST_CLASS } from "../../../fatture/detail";
import { AtDateField, useAtDate } from "../../at-date-field";
import { CostLines } from "./cost-lines";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

const eur = (value: number | null) => (value === null ? null : formatEuro(value));

/** The cost of one recipe on a day, with the lines that make it. Reads /api/recipes/:key/cost only. */
export default function RecipeCostPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const date = useAtDate();
  const [cost, setCost] = useState<RecipeCost | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startRequest] = useState(latestOnly);

  useEffect(() => {
    if (!date.ready) return;
    const isNewest = startRequest();
    void (async () => {
      const result = await apiJson<{ cost: RecipeCost }>(`/api/recipes/${key}/cost${date.query}`);
      if (!isNewest()) return;
      setMessage(null);
      setError(null);
      if (result.ok) return setCost(result.data.cost);
      setCost(null);
      if (result.status === FORBIDDEN) setMessage(t("costError.forbidden"));
      else if (result.status === NOT_FOUND) setMessage(result.error.message);
      else setError(result.error.message);
    })();
  }, [key, date.ready, date.query, startRequest]);

  const dateField = (
    <AtDateField value={date.at || date.today} max={date.today} onChange={date.change} />
  );

  if (!cost) {
    return (
      <>
        <Heading>{t("costs.title")}</Heading>
        {dateField}
        <ErrorAlert message={message ?? error} />
        {!message && !error && <Muted>{t("common.loading")}</Muted>}
        <BackLink />
      </>
    );
  }

  return (
    <>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{cost.name}</Heading>
      </div>
      {dateField}
      <Card className="flex flex-col gap-3 py-1">
        <p className="border-b border-rule py-3 font-bold">
          {t("costs.recipe.version", { version: cost.version })}
        </p>
        <dl className={DETAIL_LIST_CLASS}>
          {cost.type === "batch" && (
            <>
              <Detail
                label={t("costs.recipe.batchTotal")}
                value={eur(cost.totalCostEur)}
                testId="cost-total"
                numeric
              />
              <Detail
                label={t("costs.recipe.perPortion")}
                value={eur(cost.unitCostEur)}
                testId="cost-unit"
                numeric
              />
            </>
          )}
          {cost.type === "sub" && (
            <Detail
              label={t("costs.recipe.perUnit", { unit: cost.costUnit })}
              value={eur(cost.unitCostEur)}
              testId="cost-unit"
              numeric
            />
          )}
          {cost.type === "plate" && (
            <Detail
              label={t("costs.recipe.plateFood")}
              value={eur(cost.totalCostEur)}
              testId="cost-total"
              numeric
            />
          )}
        </dl>
        {cost.incomplete && (
          <div className="flex flex-col gap-1 pb-2">
            <Badge tone="danger">{t("costs.recipe.incomplete")}</Badge>
            {incompleteNotes(cost).map((note) => (
              <p key={note} className="text-warning">
                {note}
              </p>
            ))}
          </div>
        )}
      </Card>
      {cost.plate && <PlateOutputs plate={cost.plate} />}
      <SubHeading>{t("costs.recipe.linesTitle")}</SubHeading>
      <CostLines lines={cost.lines} />
      <BackLink />
    </>
  );
}

function PlateOutputs({ plate }: { plate: NonNullable<RecipeCost["plate"]> }) {
  const status = statusView(plate.status);
  const figures = plateFigures(plate);
  const notes = incompleteNotes(plate);
  return (
    <Card className="flex flex-col gap-1.5">
      <Badge tone={status.tone}>{status.label}</Badge>
      {figures.costLine && <p className="num">{figures.costLine}</p>}
      {figures.priceLine && <p className="num">{figures.priceLine}</p>}
      {notes.map((note) => (
        <p key={note} className="text-warning">
          {note}
        </p>
      ))}
    </Card>
  );
}

function BackLink() {
  return (
    <Link href="/costi" className={linkClass}>
      {t("costs.recipe.back")}
    </Link>
  );
}
