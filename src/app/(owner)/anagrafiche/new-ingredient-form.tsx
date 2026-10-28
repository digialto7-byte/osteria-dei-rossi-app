"use client";

import { useState, type KeyboardEvent } from "react";
import { Button, ErrorAlert, Field, Select, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { BASE_UNITS, type BaseUnit } from "@/lib/units/units";

export interface NewIngredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
}

/**
 * A small "Nuovo ingrediente" form for the places that need one on the spot: the invoice review and a supplier's
 * product form. Only a name and a unit; the rest (category, shelf life, allergens) is edited on the ingredients page.
 * It is not a <form>, because it sits inside other forms: the button and the Enter key do the submitting. The server
 * decides what is valid, and its text is shown here.
 */
export function NewIngredientForm({
  onCreated,
  onCancel,
}: {
  onCreated: (ingredient: NewIngredient) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>("kg");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return setError(t("ingredients.nameRequired"));
    setBusy(true);
    setError(null);
    const result = await apiJson<{ ingredient: NewIngredient }>("/api/ingredients", {
      method: "POST",
      body: { name: trimmed, baseUnit },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    const { id, name: savedName, baseUnit: savedUnit } = result.data.ingredient;
    onCreated({ id, name: savedName, baseUnit: savedUnit });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!busy) void create();
  }

  return (
    <div
      role="group"
      aria-label={t("ingredients.new")}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
    >
      <Field label={t("common.name")}>
        <TextInput
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </Field>
      <Field label={t("ingredients.baseUnit")}>
        <Select value={baseUnit} onChange={(event) => setBaseUnit(event.target.value as BaseUnit)}>
          {BASE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`unit.${unit}`)}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorAlert message={error} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} aria-busy={busy} onClick={() => void create()}>
          {t("ingredients.create")}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
