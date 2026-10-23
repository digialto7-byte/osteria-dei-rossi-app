"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, Select, SubHeading, TextInput } from "@/components/ui";
import { parseUsedQty, parseWholeNumber, portionsHint, qtyToInput } from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time/format";
import type { StockInputUnit } from "@/server/stock/constants";
import type { BatchProposal } from "@/server/batches/types";
import { InputRow, type InputRowValue } from "./input-row";

/** What the form sends to POST /api/batches. */
export interface ProduceRequest {
  recipeId: string;
  outputQty: number;
  portions: number;
  shelfLifeHours: number;
  locationId?: string;
  inputs: Array<{
    ingredientId: string;
    qty: number;
    unit: StockInputUnit;
    locationId?: string;
    lotId?: string;
  }>;
}

const PORTIONS_MAX = 10_000;
const SHELF_LIFE_MAX = 8760;

function initialValues(proposal: BatchProposal | null): Record<string, InputRowValue> {
  return Object.fromEntries(
    (proposal?.inputs ?? [])
      .filter((input) => input.isStock)
      .map((input) => [
        input.ingredientId,
        {
          qty: qtyToInput(input.proposedQty),
          unit: input.units[0] ?? "kg",
          locationId: input.suggestedLocationId ?? "",
          lotId: "",
        },
      ]),
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section
    aria-label={title}
    className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
  >
    <SubHeading>{title}</SubHeading>
    {children}
  </section>
);

/**
 * "Nuova produzione": the recipe, the quantity produced, the ingredients really used (prefilled with the proposal,
 * which is computed by the API) and the batch itself (portions, shelf life, use-by). One primary button. It only reads
 * what the chef typed and what the proposal says; scaling, FEFO, the lot code and the cost are the database's. A new
 * proposal (the page changes the `key` of this form) resets what the chef typed.
 */
export function ProductionForm({
  recipes,
  proposal,
  busy,
  error,
  errorIngredientIds,
  onCalculate,
  onShelfLife,
  onSubmit,
}: {
  recipes: readonly { key: string; name: string }[];
  proposal: BatchProposal | null;
  busy: boolean;
  error: string | null;
  /** Ingredients the last error names; their rows show the message. */
  errorIngredientIds: readonly string[];
  onCalculate: (recipeKey: string, outputQty: number) => void;
  onShelfLife: (hours: number) => void;
  onSubmit: (request: ProduceRequest) => void;
}) {
  const [recipeKey, setRecipeKey] = useState(proposal?.recipe.key ?? "");
  const [output, setOutput] = useState(proposal ? qtyToInput(proposal.outputQty) : "");
  const [values, setValues] = useState(() => initialValues(proposal));
  const [portions, setPortions] = useState(proposal ? String(proposal.portionsComputed) : "");
  const [shelf, setShelf] = useState(proposal ? String(proposal.shelfLifeHours) : "");
  const [batchLocation, setBatchLocation] = useState(proposal?.suggestedLocationId ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const several = (proposal?.locations.length ?? 0) >= 2;
  const unit = proposal?.recipe.outputUnit ?? "kg";
  // The proposal is only valid for the recipe and the output it was computed for. Comparing is all this does.
  const typedOutput = parseUsedQty(output);
  const stale =
    proposal !== null && (recipeKey !== proposal.recipe.key || typedOutput !== proposal.outputQty);

  function calculate() {
    const qty = parseUsedQty(output);
    if (!recipeKey) return setProblem(t("production.recipePlaceholder"));
    if (qty === null || qty <= 0) return setProblem(t("production.output.invalid"));
    setProblem(null);
    onCalculate(recipeKey, qty);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!proposal || stale) return;
    const outputQty = typedOutput;
    if (outputQty === null || outputQty <= 0) return setProblem(t("production.output.invalid"));
    const portionCount = parseWholeNumber(portions);
    if (portionCount === null || portionCount < 1 || portionCount > PORTIONS_MAX) {
      return setProblem(t("batchError.portions_invalid"));
    }
    const hours = parseWholeNumber(shelf);
    if (hours === null || hours < 1 || hours > SHELF_LIFE_MAX) {
      return setProblem(t("production.shelf.invalid"));
    }
    const inputs: ProduceRequest["inputs"] = [];
    for (const input of proposal.inputs.filter((entry) => entry.isStock)) {
      const value = values[input.ingredientId]!;
      const qty = parseUsedQty(value.qty);
      if (qty === null) return setProblem(t("production.qty.invalid"));
      inputs.push({
        ingredientId: input.ingredientId,
        qty,
        unit: value.unit as StockInputUnit,
        ...(several && value.locationId ? { locationId: value.locationId } : {}),
        ...(value.lotId ? { lotId: value.lotId } : {}),
      });
    }
    setProblem(null);
    onSubmit({
      recipeId: proposal.recipe.id,
      outputQty,
      portions: portionCount,
      shelfLifeHours: hours,
      ...(several && batchLocation ? { locationId: batchLocation } : {}),
      inputs,
    });
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-4" aria-label={t("production.new")}>
      <Section title={t("production.section.recipe")}>
        <Field label={t("production.recipe")}>
          <Select
            name="recipe"
            value={recipeKey}
            onChange={(event) => setRecipeKey(event.target.value)}
          >
            <option value="">{t("production.recipePlaceholder")}</option>
            {recipes.map((recipe) => (
              <option key={recipe.key} value={recipe.key}>
                {recipe.name}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section title={t("production.section.output")}>
        <Field label={t("production.output")}>
          <span className="flex items-center gap-2">
            <TextInput
              name="output"
              inputMode="decimal"
              autoComplete="off"
              value={output}
              onChange={(event) => setOutput(event.target.value)}
            />
            <span className="num text-ink-muted">{unit}</span>
          </span>
        </Field>
        <div>
          <Button variant="secondary" disabled={busy} onClick={calculate}>
            {t("production.calculate")}
          </Button>
        </div>
      </Section>

      <Section title={t("production.section.inputs")}>
        {proposal ? (
          <ul className="flex flex-col gap-3">
            {proposal.inputs.map((input) => (
              <InputRow
                key={input.ingredientId}
                input={input}
                locations={proposal.locations}
                value={
                  values[input.ingredientId] ?? { qty: "", unit: "kg", locationId: "", lotId: "" }
                }
                error={errorIngredientIds.includes(input.ingredientId) ? error : null}
                onChange={(patch) =>
                  setValues((current) => ({
                    ...current,
                    [input.ingredientId]: { ...current[input.ingredientId]!, ...patch },
                  }))
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">{t("production.needCalculate")}</p>
        )}
      </Section>

      <Section title={t("production.section.batch")}>
        {proposal ? (
          <>
            <Field
              label={t("production.portions")}
              hint={portionsHint(
                proposal.portionsComputed,
                proposal.recipe.portionSize,
                proposal.recipe.outputUnit,
              )}
            >
              <TextInput
                name="portions"
                inputMode="numeric"
                autoComplete="off"
                value={portions}
                onChange={(event) => setPortions(event.target.value)}
              />
            </Field>
            <Field label={t("production.shelfLife")}>
              <TextInput
                name="shelfLife"
                inputMode="numeric"
                autoComplete="off"
                value={shelf}
                onChange={(event) => setShelf(event.target.value)}
                onBlur={() => {
                  const hours = parseWholeNumber(shelf);
                  if (
                    hours !== null &&
                    hours >= 1 &&
                    hours <= SHELF_LIFE_MAX &&
                    hours !== proposal.shelfLifeHours
                  ) {
                    onShelfLife(hours);
                  }
                }}
              />
            </Field>
            <p className="num text-ink-muted">
              {t("production.useByPreview", {
                date: formatDateTime(new Date(proposal.useByPreview)),
              })}
            </p>
            {several && (
              <Field label={t("production.batchLocation")}>
                <Select
                  name="batchLocation"
                  value={batchLocation}
                  onChange={(event) => setBatchLocation(event.target.value)}
                >
                  {!batchLocation && <option value="">{t("production.recipePlaceholder")}</option>}
                  {proposal.locations.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        ) : (
          <p className="text-ink-muted">{t("production.needCalculate")}</p>
        )}
      </Section>

      <ErrorAlert message={problem ?? error} />
      {stale && <p className="text-ink-muted">{t("production.stale")}</p>}
      {proposal && (
        <div>
          <Button type="submit" disabled={busy || stale}>
            {t("production.submit")}
          </Button>
        </div>
      )}
    </form>
  );
}
