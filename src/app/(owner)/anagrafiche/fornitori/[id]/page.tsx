"use client";

import { BackLink } from "@/components/back-link";
import { NewIngredientForm } from "../../new-ingredient-form";
import { use, useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  Select,
  SubHeading,
  TextInput,
  SuccessNote,
} from "@/components/ui";
import { useMe } from "@/components/use-me";
import { useSuccessNote } from "@/components/use-success-note";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { parseDecimal } from "@/lib/numbers/parse-decimal";
import { canEditMasterData } from "@/lib/master/master-access";
import { formatQty, MEASURE_UNITS, toBase, type MeasureUnit } from "@/lib/units";
import { StatementLink } from "./statement-link";

interface Supplier {
  id: string;
  name: string;
  vatNumber: string | null;
  isActive: boolean;
}

interface Ingredient {
  id: string;
  name: string;
  baseUnit: string;
}

interface Item {
  id: string;
  ingredientId: string;
  supplierCode: string | null;
  packCount: number;
  packQty: number;
  packUnit: MeasureUnit;
  packLabel: string | null;
  baseQtyPerPack: number;
  baseUnit: MeasureUnit;
  isPreferred: boolean;
  isActive: boolean;
}

/** A typed number as a value, or null when it is empty or not a number (the caller says which field). */
function readNumber(text: string): { value: number | null } {
  const parsed = parseDecimal(text);
  return { value: parsed.ok ? parsed.value : null };
}

const EMPTY_ITEM = {
  ingredientId: "",
  supplierCode: "",
  packLabel: "",
  packCount: "1",
  packQty: "",
  packUnit: "kg" as MeasureUnit,
};
const DEFAULT_PACK_LABEL = "conf.";

/** "1 cassa = 6 × 1 kg = 6 kg", or null while the pack is incomplete or invalid. */
function packPreview(label: string, count: number, size: number, unit: MeasureUnit): string | null {
  try {
    const total = toBase(1, "conf", { count, size, unit });
    return t("suppliers.packPreview", {
      label: label || DEFAULT_PACK_LABEL,
      count: String(count),
      size: formatQty(size, unit),
      total: formatQty(total.qty, total.unit),
    });
  } catch {
    return null;
  }
}

export default function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [creatingIngredient, setCreatingIngredient] = useState(false);
  const feedback = useSuccessNote();
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_ITEM);
  // The role comes from the one cached /api/me read. Owner and admin write; the chef reads (the API refuses the rest).
  const role = useMe().me?.user.role ?? null;
  const canEdit = role !== null && canEditMasterData(role);

  const load = useCallback(async () => {
    const [supplierResult, ingredientsResult, itemsResult] = await Promise.all([
      apiJson<{ supplier: Supplier }>(`/api/suppliers/${id}`),
      apiJson<{ ingredients: Ingredient[] }>("/api/ingredients"),
      apiJson<{ items: Item[] }>(`/api/supplier-items?supplierId=${id}&active=all`),
    ]);
    if (!supplierResult.ok) return setError(supplierResult.error.message);
    setSupplier(supplierResult.data.supplier);
    if (ingredientsResult.ok) setIngredients(ingredientsResult.data.ingredients);
    if (itemsResult.ok) setItems(itemsResult.data.items);
    else setError(itemsResult.error.message);
  }, [id]);

  useEffect(() => {
    // Loading the supplier when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function editForm(next: typeof form) {
    feedback.clear();
    setForm(next);
  }

  async function addItem(event: FormEvent) {
    event.preventDefault();
    // The Italian comma is read here (parseDecimal), like every other decimal field; a bad or empty number stops the save.
    const count = readNumber(form.packCount);
    const size = readNumber(form.packQty);
    if (count.value === null)
      return setError(t("suppliers.invalidNumber", { field: t("suppliers.packCount") }));
    if (size.value === null)
      return setError(t("suppliers.invalidNumber", { field: t("suppliers.packQty") }));
    const result = await apiJson("/api/supplier-items", {
      method: "POST",
      body: {
        supplierId: id,
        ingredientId: form.ingredientId,
        supplierCode: form.supplierCode,
        packCount: count.value,
        packQty: size.value,
        packUnit: form.packUnit,
        ...(form.packLabel ? { packLabel: form.packLabel } : {}),
      },
    });
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setForm(EMPTY_ITEM);
    feedback.show(t("suppliers.itemAdded"));
    await load();
  }

  async function patchItem(itemId: string, body: object) {
    const result = await apiJson(`/api/supplier-items/${itemId}`, { method: "PATCH", body });
    if (!result.ok) return setListError(result.error.message);
    setListError(null);
    await load();
  }

  const ingredientName = (ingredientId: string) =>
    ingredients.find((ingredient) => ingredient.id === ingredientId)?.name ?? "—";
  const previewCount = readNumber(form.packCount);
  const previewSize = readNumber(form.packQty);
  const preview =
    previewCount.value !== null && previewSize.value !== null
      ? packPreview(form.packLabel, previewCount.value, previewSize.value, form.packUnit)
      : null;

  if (!supplier) {
    return (
      <>
        <BackLink href="/anagrafiche/fornitori">{t("suppliers.back")}</BackLink>
        <ErrorAlert message={error} />
        {!error && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  return (
    <>
      <BackLink href="/anagrafiche/fornitori">{t("suppliers.back")}</BackLink>
      <div className="flex flex-col gap-1 [overflow-wrap:anywhere]">
        <Heading>{supplier.name}</Heading>
        <p className="num text-ink-muted">{supplier.vatNumber ?? "—"}</p>
      </div>
      <StatementLink supplierId={supplier.id} role={role} />

      <SubHeading>{t("suppliers.items")}</SubHeading>
      <ErrorAlert message={listError} />
      {items.length === 0 ? (
        <Muted>{t("common.empty")}</Muted>
      ) : (
        <LedgerList>
          {items.map((item) => (
            <LedgerRow key={item.id} className="flex flex-col gap-1.5 py-3">
              <span className="font-bold [overflow-wrap:anywhere]">
                {item.supplierCode} · {ingredientName(item.ingredientId)}
                {item.isPreferred && ` · ${t("suppliers.preferred")}`}
                {!item.isActive && ` (${t("common.inactive")})`}
              </span>
              <span data-testid="pack" className="num text-ink-muted">
                {t("suppliers.packPreview", {
                  label: item.packLabel ?? DEFAULT_PACK_LABEL,
                  count: String(item.packCount),
                  size: formatQty(item.packQty, item.packUnit),
                  total: formatQty(item.baseQtyPerPack, item.baseUnit),
                })}
              </span>
              {canEdit && (
                <span className="mt-1 flex flex-wrap gap-2">
                  {item.isActive && !item.isPreferred && (
                    <Button
                      variant="secondary"
                      onClick={() => patchItem(item.id, { isPreferred: true })}
                    >
                      {t("suppliers.makePreferred")}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => patchItem(item.id, { isActive: !item.isActive })}
                  >
                    {item.isActive ? t("common.deactivate") : t("common.reactivate")}
                  </Button>
                </span>
              )}
            </LedgerRow>
          ))}
        </LedgerList>
      )}

      {canEdit && (
        <Card>
          <form
            onSubmit={addItem}
            className="flex flex-col gap-4"
            aria-label={t("suppliers.newItem")}
          >
            <SubHeading>{t("suppliers.newItem")}</SubHeading>
            <Field label={t("suppliers.ingredient")}>
              <Select
                value={form.ingredientId}
                onChange={(e) => editForm({ ...form, ingredientId: e.target.value })}
                required
              >
                <option value="">{t("suppliers.chooseIngredient")}</option>
                {ingredients.map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>
                    {ingredient.name} ({ingredient.baseUnit})
                  </option>
                ))}
              </Select>
            </Field>
            {creatingIngredient ? (
              <NewIngredientForm
                onCreated={(created) => {
                  setForm((current) => ({ ...current, ingredientId: created.id }));
                  setCreatingIngredient(false);
                  void load();
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
            <Field label={t("suppliers.code")}>
              <TextInput
                value={form.supplierCode}
                onChange={(e) => editForm({ ...form, supplierCode: e.target.value })}
                required
                maxLength={64}
              />
            </Field>
            <Field label={t("suppliers.packLabel")}>
              <TextInput
                value={form.packLabel}
                onChange={(e) => editForm({ ...form, packLabel: e.target.value })}
                maxLength={30}
              />
            </Field>
            <Field label={t("suppliers.packCount")}>
              <TextInput
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.packCount}
                onChange={(e) => editForm({ ...form, packCount: e.target.value })}
                required
              />
            </Field>
            <Field label={t("suppliers.packQty")}>
              <TextInput
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.packQty}
                onChange={(e) => editForm({ ...form, packQty: e.target.value })}
                required
              />
            </Field>
            <Field label={t("suppliers.packUnit")}>
              <Select
                value={form.packUnit}
                onChange={(e) => editForm({ ...form, packUnit: e.target.value as MeasureUnit })}
              >
                {MEASURE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </Select>
            </Field>
            {preview && (
              <p
                data-testid="pack-preview"
                className="num rounded-lg border border-dashed border-rule-strong bg-paper px-3 py-2"
              >
                {preview}
              </p>
            )}
            {feedback.note && <SuccessNote role="status">{feedback.note}</SuccessNote>}
            <ErrorAlert message={error} />
            <Button type="submit">{t("common.add")}</Button>
          </form>
        </Card>
      )}
    </>
  );
}
