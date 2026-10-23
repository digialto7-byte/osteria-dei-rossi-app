"use client";

import { useState, type FormEvent } from "react";
import { Badge, Button, Checkbox, ErrorAlert } from "@/components/ui";
import {
  allergenCellText,
  confirmedOnText,
  needsConfirmation,
} from "@/lib/ingredients/allergen-view";
import { t } from "@/lib/i18n";
import { allergenLabel } from "@/lib/recipes/recipe-view";
import { ALLERGENS, type Ingredient } from "@/server/master/ingredients";

type AllergenFields = Pick<
  Ingredient,
  "id" | "name" | "allergens" | "allergenStatus" | "allergensConfirmedAt"
>;

/**
 * What an ingredient says about its allergens: the list in words ("Non indicati" is not "Nessuno"),
 * "da confermare" until the owner confirms, then when. Only the owner gets the confirm button.
 */
export function AllergenCell({
  ingredient,
  canConfirm,
  onConfirm,
}: {
  ingredient: AllergenFields;
  canConfirm: boolean;
  onConfirm: () => void;
}) {
  const todo = needsConfirmation(ingredient.allergenStatus);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <p className="[overflow-wrap:anywhere]">
        {t("ingredients.allergenState.label", { value: allergenCellText(ingredient.allergens) })}
      </p>
      {todo ? (
        <Badge tone="warning">{t("ingredients.allergenState.todo")}</Badge>
      ) : (
        ingredient.allergensConfirmedAt && (
          <p className="num text-sm text-ink-muted">
            {confirmedOnText(ingredient.allergensConfirmedAt)}
          </p>
        )
      )}
      {todo && canConfirm && (
        <Button variant="secondary" onClick={onConfirm}>
          {t("ingredients.confirm")}
        </Button>
      )}
    </div>
  );
}

/**
 * The owner's confirmation: 14 labelled boxes prefilled from the declared list. Confirming with no
 * box ticked says the ingredient has no allergens, which the hint spells out.
 */
export function AllergenConfirmForm({
  ingredient,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  ingredient: AllergenFields;
  busy: boolean;
  error: string | null;
  onSubmit: (allergens: (typeof ALLERGENS)[number][]) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(ingredient.allergens ?? []));
  const toggle = (allergen: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(allergen)) next.add(allergen);
      return next;
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(ALLERGENS.filter((allergen) => chosen.has(allergen)));
  }

  return (
    <form
      onSubmit={submit}
      className="flex w-full flex-col gap-2 rounded-lg border border-rule p-3"
    >
      <ErrorAlert message={error} />
      <fieldset className="flex flex-col">
        <legend className="mb-1 font-bold">
          {t("ingredients.confirm.legend", { name: ingredient.name })}
        </legend>
        {ALLERGENS.map((allergen) => (
          <Checkbox
            key={allergen}
            label={allergenLabel(allergen)}
            checked={chosen.has(allergen)}
            onChange={() => toggle(allergen)}
          />
        ))}
      </fieldset>
      <p className="text-sm leading-snug text-ink-muted">{t("ingredients.confirm.hint")}</p>
      <p className="text-sm leading-snug text-ink-muted">{t("ingredients.confirm.noneHint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {t("ingredients.confirm.submit")}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
