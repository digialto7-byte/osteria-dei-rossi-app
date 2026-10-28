"use client";

import { useState, type FormEvent } from "react";
import { Button, Checkbox, ErrorAlert, Field, Select, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { buildLinePatch, initialLineForm, type LineForm } from "@/lib/invoices/line-form";
import { LINE_UNITS } from "@/lib/units";
import { NewIngredientForm } from "../../../anagrafiche/new-ingredient-form";
import type { ReviewLine } from "@/server/invoices/review-types";
import type { CostCentreOption, IngredientOption, LineActions } from "./actions";
import { SplitForm } from "./split-form";

const unitLabel = (unit: string) => (unit === "conf" ? t("review.unit.conf") : unit);

const numberInput = {
  inputMode: "decimal" as const,
  autoComplete: "off",
};

interface LineEditorProps {
  line: ReviewLine;
  ingredients: IngredientOption[];
  costCentres: CostCentreOption[];
  /** A part of a split line: its quantity and amounts are fixed by the split. */
  child?: boolean;
  actions: LineActions;
  onClose: () => void;
  /** An ingredient made from this editor: the screen adds it to the list every line editor offers. */
  onIngredientCreated?: (ingredient: IngredientOption) => void;
}

/**
 * The form behind "Modifica": map the line, book it as non-stock, record a credit, a lot or an
 * expiry, correct what was read, or split it. It sends only what changed. Every rule is the
 * API's; its Italian message is shown here, next to the form.
 */
export function LineEditor({
  line,
  ingredients,
  costCentres,
  child = false,
  actions,
  onClose,
  onIngredientCreated,
}: LineEditorProps) {
  const [form, setForm] = useState<LineForm>(() => initialLineForm(line));
  const [newCentre, setNewCentre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [creatingIngredient, setCreatingIngredient] = useState(false);
  const set = <K extends keyof LineForm>(key: K, value: LineForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  if (line.isSplit) {
    return (
      <div className="flex w-full flex-col items-start gap-3 rounded-lg border border-rule p-3">
        <ErrorAlert message={error} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const failure = await actions.unsplit(line.id);
              setBusy(false);
              if (failure) setError(failure);
              else onClose();
            }}
          >
            {t("review.unsplit")}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    let values = form;
    if (!form.isStock && newCentre.trim()) {
      const made = await actions.createCentre(newCentre.trim());
      if ("error" in made) return setError(made.error);
      // Kept even if the save below fails, so a second try does not create it twice.
      values = { ...form, costCentreId: made.id };
      setForm(values);
      setNewCentre("");
    }
    const built = buildLinePatch(line, values, { child });
    if (!built.ok) return setError(built.message);
    setBusy(true);
    const failure = await actions.saveLine(line.id, built.patch);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  const showPack = !child && form.isStock && (form.unit === "conf" || line.pack !== null);
  return (
    <>
      <form
        onSubmit={submit}
        aria-label={t("review.edit")}
        className="flex w-full flex-col gap-4 rounded-lg border border-rule p-3"
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-bold">{t("review.editor.mapping")}</legend>
          <Checkbox
            label={t("review.nonStock")}
            checked={!form.isStock}
            onChange={(event) => set("isStock", !event.target.checked)}
          />
          {form.isStock ? (
            <>
              <Field label={t("review.ingredientField")}>
                <Select
                  value={form.ingredientId}
                  onChange={(event) => set("ingredientId", event.target.value)}
                >
                  <option value="">{t("review.ingredientNone")}</option>
                  {ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {`${ingredient.name} · ${ingredient.baseUnit}`}
                    </option>
                  ))}
                </Select>
              </Field>
              {creatingIngredient ? (
                <NewIngredientForm
                  onCreated={(created) => {
                    onIngredientCreated?.(created);
                    set("ingredientId", created.id);
                    setCreatingIngredient(false);
                  }}
                  onCancel={() => setCreatingIngredient(false)}
                />
              ) : (
                <div>
                  <Button variant="secondary" onClick={() => setCreatingIngredient(true)}>
                    {t("ingredients.new")}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <Field label={t("review.costCentre")}>
                <Select
                  value={form.costCentreId}
                  onChange={(event) => set("costCentreId", event.target.value)}
                >
                  <option value="">{t("review.costCentreChoose")}</option>
                  {costCentres.map((centre) => (
                    <option key={centre.id} value={centre.id}>
                      {centre.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("review.newCostCentre")} hint={t("review.newCostCentreHint")}>
                <TextInput
                  value={newCentre}
                  maxLength={60}
                  onChange={(event) => setNewCentre(event.target.value)}
                />
              </Field>
            </>
          )}
          <Field label={t("review.unitField")}>
            <Select value={form.unit} onChange={(event) => set("unit", event.target.value)}>
              <option value="">{t("review.unitNone")}</option>
              {LINE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabel(unit)}
                </option>
              ))}
            </Select>
          </Field>
          {showPack && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("suppliers.packCount")}>
                  <TextInput
                    {...numberInput}
                    value={form.packCount}
                    onChange={(event) => set("packCount", event.target.value)}
                  />
                </Field>
                <Field label={t("suppliers.packQty")}>
                  <TextInput
                    {...numberInput}
                    value={form.packSize}
                    onChange={(event) => set("packSize", event.target.value)}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("suppliers.packUnit")}>
                  <Select
                    value={form.packUnit}
                    onChange={(event) => set("packUnit", event.target.value)}
                  >
                    <option value="">{t("review.unitNone")}</option>
                    {LINE_UNITS.filter((unit) => unit !== "conf").map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("suppliers.packLabel")}>
                  <TextInput
                    value={form.packLabel}
                    maxLength={30}
                    onChange={(event) => set("packLabel", event.target.value)}
                  />
                </Field>
              </div>
            </>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-bold">{t("review.editor.values")}</legend>
          {!child && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("review.label.qty")}>
                  <TextInput
                    {...numberInput}
                    value={form.qty}
                    onChange={(event) => set("qty", event.target.value)}
                  />
                </Field>
                <Field label={t("review.label.unitPrice")}>
                  <TextInput
                    {...numberInput}
                    value={form.unitPrice}
                    onChange={(event) => set("unitPrice", event.target.value)}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("review.label.lineAmount")}>
                  <TextInput
                    {...numberInput}
                    value={form.lineAmount}
                    onChange={(event) => set("lineAmount", event.target.value)}
                  />
                </Field>
                <Field label={t("review.label.vatRate")}>
                  <TextInput
                    {...numberInput}
                    value={form.vatRate}
                    onChange={(event) => set("vatRate", event.target.value)}
                  />
                </Field>
              </div>
              <Field label={t("review.label.supplierCode")}>
                <TextInput
                  value={form.supplierCode}
                  maxLength={64}
                  onChange={(event) => set("supplierCode", event.target.value)}
                />
              </Field>
              <Field label={t("review.label.creditQty")} hint={t("review.label.creditHint")}>
                <TextInput
                  {...numberInput}
                  value={form.creditQty}
                  onChange={(event) => set("creditQty", event.target.value)}
                />
              </Field>
            </>
          )}
          {child && (
            <Field label={t("review.label.vatRate")}>
              <TextInput
                {...numberInput}
                value={form.vatRate}
                onChange={(event) => set("vatRate", event.target.value)}
              />
            </Field>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-bold">{t("review.editor.lot")}</legend>
          <Field label={t("review.label.lotCode")}>
            <TextInput
              value={form.lotCode}
              maxLength={64}
              onChange={(event) => set("lotCode", event.target.value)}
            />
          </Field>
          <Field label={t("review.label.expiry")}>
            <TextInput
              type="date"
              value={form.expiry}
              onChange={(event) => set("expiry", event.target.value)}
            />
          </Field>
        </fieldset>

        <ErrorAlert message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {t("review.save")}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {!child && (
            <Button
              variant="secondary"
              aria-expanded={splitting}
              onClick={() => setSplitting((open) => !open)}
            >
              {t("review.split")}
            </Button>
          )}
        </div>
      </form>
      {splitting && <SplitForm line={line} actions={actions} onClose={onClose} />}
    </>
  );
}
