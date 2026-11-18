"use client";

import { BackLink } from "@/components/back-link";
import { use, useEffect, useState } from "react";
import { FactList, FactRow } from "@/components/fact-list";
import { PlateBreakdownView } from "@/components/cost/plate-breakdown";
import { Badge, Card, ErrorAlert, Heading, Muted, SubHeading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { incompleteNotes, plateFigures, statusView } from "@/lib/costing/cost-view";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import type { OwnerPlateBreakdown } from "@/server/costing/plate-breakdown";
import type { RecipeCost } from "@/server/costing/types";
import { AtDateField, useAtDate } from "../../at-date-field";
import { CostLines } from "./cost-lines";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** The cost of one recipe on a day, with the lines that make it. Reads /api/recipes/:key/cost only. */
export default function RecipeCostPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const date = useAtDate();
  const [cost, setCost] = useState<RecipeCost | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startRequest] = useState(latestOnly);
  const [breakdown, setBreakdown] = useState<OwnerPlateBreakdown | null>(null);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const isPlate = cost?.type === "plate";

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

  // A plate's cost by line (UX plan P1-10), for the same day as the cost above. Other recipes have no breakdown.
  useEffect(() => {
    if (!date.ready || !isPlate) return;
    let cancelled = false;
    // The old day's breakdown goes before the new one is asked for, so two days never sit side by side.
    /* eslint-disable react-hooks/set-state-in-effect */
    setBreakdown(null);
    setBreakdownError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const result = await apiJson<OwnerPlateBreakdown>(`/api/costs/plates/${key}${date.query}`);
      if (cancelled) return;
      setBreakdown(result.ok ? result.data : null);
      setBreakdownError(result.ok ? null : result.error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, date.ready, date.query, isPlate]);

  const dateField = (
    <AtDateField value={date.at || date.today} max={date.today} onChange={date.change} />
  );

  if (!cost) {
    return (
      <>
        {/* A role that may not read the costs is given no link into them. */}
        {message !== t("costError.forbidden") && (
          <BackLink href="/costi">{t("costs.recipe.back")}</BackLink>
        )}
        <Heading>{t("costs.title")}</Heading>
        {dateField}
        <ErrorAlert message={message ?? error} />
        {!message && !error && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  return (
    <>
      <BackLink href="/costi">{t("costs.recipe.back")}</BackLink>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{cost.name}</Heading>
      </div>
      {dateField}
      <Card className="flex flex-col gap-3">
        <p className="font-bold">{t("costs.recipe.version", { version: cost.version })}</p>
        <FactList>
          {cost.type === "batch" && (
            <>
              <CostFact
                label={t("costs.recipe.batchTotal")}
                value={cost.totalCostEur}
                testId="cost-total"
              />
              <CostFact
                label={t("costs.recipe.perPortion")}
                value={cost.unitCostEur}
                testId="cost-unit"
              />
            </>
          )}
          {cost.type === "sub" && (
            <CostFact
              label={t("costs.recipe.perUnit", { unit: cost.costUnit })}
              value={cost.unitCostEur}
              testId="cost-unit"
            />
          )}
          {cost.type === "plate" && (
            <CostFact
              label={t("costs.recipe.plateFood")}
              value={cost.totalCostEur}
              testId="cost-total"
            />
          )}
        </FactList>
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
      {isPlate && <ErrorAlert message={breakdownError} />}
      {isPlate && breakdown && <PlateBreakdownView breakdown={breakdown} showMoney />}
      <SubHeading>{t("costs.recipe.linesTitle")}</SubHeading>
      <CostLines lines={cost.lines} />
    </>
  );
}

/** A cost row; a cost the reading could not work out (null) is left out, as before. */
function CostFact({
  label,
  value,
  testId,
}: {
  label: string;
  value: number | null;
  testId: string;
}) {
  if (value === null) return null;
  return (
    <FactRow label={label} testId={testId}>
      <strong>{formatEuro(value)}</strong>
    </FactRow>
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
