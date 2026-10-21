"use client";

import { useState, type FormEvent } from "react";
import { Button, Checkbox, ErrorAlert, Field, Heading, Select, TextInput } from "@/components/ui";
import { useApiList } from "@/components/use-api-list";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { BASE_UNITS, type BaseUnit } from "@/lib/units/units";

interface Ingredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  category: string | null;
  allergens: string[];
  isActive: boolean;
}

const EMPTY_FORM = { name: "", baseUnit: "kg" as BaseUnit, category: "", shelfLife: "" };

export default function IngredientsPage() {
  const list = useApiList<Ingredient>("/api/ingredients", "ingredients");
  const [form, setForm] = useState(EMPTY_FORM);

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

  return (
    <>
      <Heading>{t("ingredients.title")}</Heading>
      <form onSubmit={create} className="flex flex-col gap-3" aria-label={t("ingredients.new")}>
        <Field label={t("common.name")}>
          <TextInput
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            maxLength={120}
          />
        </Field>
        <Field label={t("ingredients.baseUnit")}>
          <Select
            value={form.baseUnit}
            onChange={(e) => setForm({ ...form, baseUnit: e.target.value as BaseUnit })}
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
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            maxLength={60}
          />
        </Field>
        <Field label={t("ingredients.shelfLife")}>
          <TextInput
            type="number"
            inputMode="numeric"
            min={1}
            value={form.shelfLife}
            onChange={(e) => setForm({ ...form, shelfLife: e.target.value })}
          />
        </Field>
        <Button type="submit">{t("common.add")}</Button>
      </form>
      <ErrorAlert message={list.error} />
      <Checkbox
        label={t("common.showInactive")}
        checked={list.showInactive}
        onChange={(e) => list.setShowInactive(e.target.checked)}
      />
      {list.items === null ? (
        <p>{t("common.loading")}</p>
      ) : list.items.length === 0 ? (
        <p>{t("common.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-stone-200">
          {list.items.map((ingredient) => (
            <li key={ingredient.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                {ingredient.name} · {ingredient.baseUnit}
                {ingredient.category && (
                  <span className="text-stone-600"> · {ingredient.category}</span>
                )}
                {!ingredient.isActive && (
                  <span className="text-stone-600"> ({t("common.inactive")})</span>
                )}
              </span>
              <Button variant="secondary" onClick={() => toggle(ingredient)}>
                {ingredient.isActive ? t("common.deactivate") : t("common.reactivate")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
