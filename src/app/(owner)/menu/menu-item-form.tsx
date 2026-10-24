"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Card, Checkbox, ErrorAlert, Field, Select, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { MenuFormErrors, MenuFormState } from "@/lib/menu/menu-form";
import { courseWord } from "@/lib/menu/menu-view";

export interface RecipeChoice {
  key: string;
  name: string;
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="-mt-2 text-sm text-danger">{message}</p> : null;
}

/**
 * The "Nuovo piatto" and "Modifica piatto" form. It holds what is typed (strings); the page turns it into the API
 * body with menu-form.ts and shows the field errors it gets back. The VAT rate is pre-filled from the server's
 * default, never guessed here; "Nessuna ricetta" saves the dish unmapped. "Attivo" exists in edit mode only.
 */
export function MenuItemForm({
  mode,
  initial,
  recipes,
  currentRecipe,
  vatRates,
  courses,
  categories,
  busy,
  error,
  errors,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial: MenuFormState;
  recipes: readonly RecipeChoice[];
  /** The recipe the item is mapped to, kept as an option even when it is no longer an active plate. */
  currentRecipe?: RecipeChoice | null;
  vatRates: readonly number[];
  courses: readonly string[];
  categories: readonly string[];
  busy: boolean;
  error: string | null;
  errors: MenuFormErrors;
  onSubmit: (state: MenuFormState) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState(initial);
  const listId = useId();
  const set = <K extends keyof MenuFormState>(key: K, value: MenuFormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));
  const choices =
    currentRecipe && !recipes.some((recipe) => recipe.key === currentRecipe.key)
      ? [currentRecipe, ...recipes]
      : recipes;

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(state);
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <h2 className="font-display text-[1.5rem] leading-tight font-semibold">
          {t(mode === "create" ? "menu.form.newTitle" : "menu.form.editTitle")}
        </h2>
        <Field label={t("menu.form.name")}>
          <TextInput
            name="name"
            value={state.name}
            disabled={busy}
            aria-invalid={errors.name ? true : undefined}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        <FieldError message={errors.name} />
        <Field label={t("menu.form.category")}>
          <>
            <TextInput
              name="category"
              list={listId}
              value={state.category}
              disabled={busy}
              aria-invalid={errors.category ? true : undefined}
              onChange={(event) => set("category", event.target.value)}
            />
            <datalist id={listId}>
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </>
        </Field>
        <FieldError message={errors.category} />
        <Field label={t("menu.form.course")}>
          <Select
            name="course"
            value={state.course}
            disabled={busy}
            onChange={(event) => set("course", event.target.value)}
          >
            {courses.map((course) => (
              <option key={course} value={course}>
                {courseWord(course)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("menu.form.recipe")}>
          <Select
            name="recipe"
            value={state.recipeKey}
            disabled={busy}
            onChange={(event) => set("recipeKey", event.target.value)}
          >
            <option value="">{t("menu.form.recipe.none")}</option>
            {choices.map((recipe) => (
              <option key={recipe.key} value={recipe.key}>
                {recipe.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("menu.form.price")}>
          <TextInput
            name="price"
            type="text"
            inputMode="decimal"
            value={state.price}
            disabled={busy}
            aria-invalid={errors.price ? true : undefined}
            onChange={(event) => set("price", event.target.value)}
          />
        </Field>
        <FieldError message={errors.price} />
        <Field label={t("menu.form.vatRate")}>
          <Select
            name="vatRate"
            value={state.vatRate}
            disabled={busy}
            aria-invalid={errors.vatRate ? true : undefined}
            onChange={(event) => set("vatRate", event.target.value)}
          >
            {state.vatRate === "" && <option value="">{t("menu.form.vatRate.choose")}</option>}
            {vatRates.map((rate) => (
              <option key={rate} value={String(rate)}>
                {t("menu.form.vatRate.option", { rate })}
              </option>
            ))}
          </Select>
        </Field>
        <FieldError message={errors.vatRate} />
        <Field label={t("menu.form.position")}>
          <TextInput
            name="position"
            type="text"
            inputMode="numeric"
            value={state.position}
            disabled={busy}
            aria-invalid={errors.position ? true : undefined}
            onChange={(event) => set("position", event.target.value)}
          />
        </Field>
        <FieldError message={errors.position} />
        <Checkbox
          label={t("menu.form.available")}
          checked={state.available}
          disabled={busy}
          onChange={(event) => set("available", event.target.checked)}
        />
        {mode === "edit" && (
          <Checkbox
            label={t("menu.form.active")}
            checked={state.active}
            disabled={busy}
            onChange={(event) => set("active", event.target.checked)}
          />
        )}
        <ErrorAlert message={error} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            {t("common.save")}
          </Button>
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
