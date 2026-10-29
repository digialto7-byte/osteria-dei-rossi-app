"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  Select,
  TextInput,
  SuccessNote,
} from "@/components/ui";
import { DeactivateButton } from "@/components/deactivate-button";
import { FacetLinks } from "@/components/facet-links";
import { EmptyState } from "@/components/empty-state";
import { NameFilter, NoMatches } from "@/components/name-filter";
import { emptyFor } from "@/lib/empty/empty-content";
import { CollapsibleAdd, useCollapsibleAdd } from "@/components/collapsible-add";
import { useApiList } from "@/components/use-api-list";
import { useHashScroll } from "@/components/use-hash-scroll";
import { useMe } from "@/components/use-me";
import { useSuccessNote } from "@/components/use-success-note";
import { apiJson } from "@/lib/api/client";
import { canConfirmAllergens } from "@/lib/ingredients/allergen-view";
import { t } from "@/lib/i18n";
import { filterByName } from "@/lib/list/name-filter";
import { canEditMasterData } from "@/lib/master/master-access";
import { ingredientFacets } from "@/lib/nav/facet-links";
import { BASE_UNITS, type BaseUnit } from "@/lib/units/units";
import type { Ingredient } from "@/server/master/ingredients";
import { AllergenCell, AllergenConfirmForm } from "./allergen-confirm-form";

const EMPTY_FORM = { name: "", baseUnit: "kg" as BaseUnit, category: "", shelfLife: "" };

export default function IngredientsPage() {
  const list = useApiList<Ingredient>("/api/ingredients", "ingredients");
  const [form, setForm] = useState(EMPTY_FORM);
  const [query, setQuery] = useState("");
  const feedback = useSuccessNote();
  const add = useCollapsibleAdd(list.items?.length ?? null);
  const edit = (next: typeof EMPTY_FORM) => {
    feedback.clear();
    setForm(next);
  };
  // The role comes from the one cached /api/me read shared with the app shell. Only the owner confirms allergens (Q6);
  // owner and admin write master data. Until the role is known no confirm button and no form show.
  const role = useMe().me?.user.role ?? null;
  const canEdit = role !== null && canEditMasterData(role);
  useHashScroll(list.items !== null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function confirmAllergens(ingredient: Ingredient, allergens: string[]) {
    setConfirmBusy(true);
    setConfirmError(null);
    const result = await apiJson(`/api/ingredients/${ingredient.id}/allergens/confirm`, {
      method: "POST",
      body: { allergens },
    });
    setConfirmBusy(false);
    if (!result.ok) return setConfirmError(result.error.message);
    setConfirming(null);
    await list.reload();
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const result = await apiJson("/api/ingredients", {
      method: "POST",
      body: {
        name: form.name,
        baseUnit: form.baseUnit,
        ...(form.category ? { category: form.category } : {}),
        ...(form.shelfLife ? { defaultShelfLifeDays: Number(form.shelfLife) } : {}),
      },
    });
    if (!result.ok) return list.setError(result.error.message);
    setForm(EMPTY_FORM);
    feedback.show(t("ingredients.added"));
    add.hide();
    await list.reload();
  }

  async function toggle(ingredient: Ingredient) {
    const result = await apiJson(`/api/ingredients/${ingredient.id}`, {
      method: "PATCH",
      body: { isActive: !ingredient.isActive },
    });
    if (!result.ok) return list.setError(result.error.message);
    await list.reload();
  }

  const shown = filterByName(list.items ?? [], query);

  return (
    <>
      <Heading>{t("ingredients.title")}</Heading>
      {canEdit && (
        <CollapsibleAdd label={t("ingredients.addButton")} open={add.open} onShow={add.show}>
          <Card>
            <form
              onSubmit={create}
              className="flex flex-col gap-4"
              aria-label={t("ingredients.new")}
            >
              <Field label={t("common.name")}>
                <TextInput
                  value={form.name}
                  onChange={(e) => edit({ ...form, name: e.target.value })}
                  required
                  maxLength={120}
                />
              </Field>
              <Field label={t("ingredients.baseUnit")}>
                <Select
                  value={form.baseUnit}
                  onChange={(e) => edit({ ...form, baseUnit: e.target.value as BaseUnit })}
                >
                  {BASE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {t(`unit.${unit}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("ingredients.category")}>
                <TextInput
                  value={form.category}
                  onChange={(e) => edit({ ...form, category: e.target.value })}
                  maxLength={60}
                />
              </Field>
              <Field label={t("ingredients.shelfLife")}>
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={form.shelfLife}
                  onChange={(e) => edit({ ...form, shelfLife: e.target.value })}
                />
              </Field>
              <Button type="submit">{t("common.add")}</Button>
            </form>
          </Card>
        </CollapsibleAdd>
      )}
      {feedback.note && <SuccessNote role="status">{feedback.note}</SuccessNote>}
      <ErrorAlert message={list.error} />
      <Checkbox
        label={t("common.showInactive")}
        checked={list.showInactive}
        onChange={(e) => list.setShowInactive(e.target.checked)}
      />
      {list.items === null ? (
        !list.error && <Muted>{t("common.loading")}</Muted>
      ) : list.items.length === 0 ? (
        <EmptyState {...emptyFor("ingredients", role)} />
      ) : (
        <>
          <NameFilter value={query} onChange={setQuery} />
          {shown.length === 0 ? (
            <NoMatches query={query} onClear={() => setQuery("")} />
          ) : (
            <LedgerList>
              {shown.map((ingredient) => (
                <LedgerRow
                  key={ingredient.id}
                  id={`ingredient-${ingredient.id}`}
                  className="flex flex-col gap-2 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-bold">{ingredient.name}</span> · {ingredient.baseUnit}
                      {ingredient.category && (
                        <span className="text-ink-muted"> · {ingredient.category}</span>
                      )}
                      {!ingredient.isActive && (
                        <span className="text-ink-muted"> ({t("common.inactive")})</span>
                      )}
                    </span>
                    {canEdit && (
                      <DeactivateButton
                        name={ingredient.name}
                        isActive={ingredient.isActive}
                        onToggle={() => toggle(ingredient)}
                      />
                    )}
                  </div>
                  <AllergenCell
                    ingredient={ingredient}
                    canConfirm={canConfirmAllergens(role)}
                    onConfirm={() => {
                      setConfirmError(null);
                      setConfirming(ingredient.id);
                    }}
                  />
                  <FacetLinks links={ingredientFacets(ingredient, role, "master")} />
                  {confirming === ingredient.id && (
                    <AllergenConfirmForm
                      ingredient={ingredient}
                      busy={confirmBusy}
                      error={confirmError}
                      onSubmit={(allergens) => confirmAllergens(ingredient, allergens)}
                      onCancel={() => setConfirming(null)}
                    />
                  )}
                </LedgerRow>
              ))}
            </LedgerList>
          )}
        </>
      )}
    </>
  );
}
