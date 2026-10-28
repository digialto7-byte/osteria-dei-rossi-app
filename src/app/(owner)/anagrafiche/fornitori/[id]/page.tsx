"use client";

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
} from "@/components/ui";
import { useMe } from "@/components/use-me";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
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

  async function addItem(event: FormEvent) {
    event.preventDefault();
    const result = await apiJson("/api/supplier-items", {
      method: "POST",
      body: {
        supplierId: id,
        ingredientId: form.ingredientId,
        supplierCode: form.supplierCode,
        packCount: Number(form.packCount),
        packQty: Number(form.packQty),
        packUnit: form.packUnit,
        ...(form.packLabel ? { packLabel: form.packLabel } : {}),
      },
    });
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setForm(EMPTY_ITEM);
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
  const preview = packPreview(
    form.packLabel,
    Number(form.packCount),
    Number(form.packQty),
    form.packUnit,
  );

  if (!supplier) {
    return (
      <>
        <ErrorAlert message={error} />
        {!error && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  return (
    <>
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
                onChange={(e) => setForm({ ...form, ingredientId: e.target.value })}
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
            <Field label={t("suppliers.code")}>
              <TextInput
                value={form.supplierCode}
                onChange={(e) => setForm({ ...form, supplierCode: e.target.value })}
                required
                maxLength={64}
              />
            </Field>
            <Field label={t("suppliers.packLabel")}>
              <TextInput
                value={form.packLabel}
                onChange={(e) => setForm({ ...form, packLabel: e.target.value })}
                maxLength={30}
              />
            </Field>
            <Field label={t("suppliers.packCount")}>
              <TextInput
                type="number"
                inputMode="decimal"
                step="any"
                value={form.packCount}
                onChange={(e) => setForm({ ...form, packCount: e.target.value })}
                required
              />
            </Field>
            <Field label={t("suppliers.packQty")}>
              <TextInput
                type="number"
                inputMode="decimal"
                step="any"
                value={form.packQty}
                onChange={(e) => setForm({ ...form, packQty: e.target.value })}
                required
              />
            </Field>
            <Field label={t("suppliers.packUnit")}>
              <Select
                value={form.packUnit}
                onChange={(e) => setForm({ ...form, packUnit: e.target.value as MeasureUnit })}
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
            <ErrorAlert message={error} />
            <Button type="submit">{t("common.add")}</Button>
          </form>
        </Card>
      )}
    </>
  );
}
