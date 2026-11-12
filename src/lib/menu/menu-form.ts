import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { DecimalResult } from "@/lib/numbers/parse-decimal";
import { PORTION_WEIGHT_MAX_G, PORTION_WEIGHT_MIN_G } from "@/server/orders/constants";
import {
  MENU_CATEGORY_MAX,
  MENU_NAME_MAX,
  MENU_POSITION_MAX,
  MENU_PRICE_MAX,
  VAT_RATES,
} from "@/server/menu/constants";
import type { MenuItem } from "@/server/menu/output";
import type { CreateMenuItemBody, UpdateMenuItemBody } from "@/server/menu/schemas";

// The menu item form: what is typed (strings) to and from the API body. Pure. The database stays the authority;
// this only turns the obvious mistakes into field messages before a request.

export interface MenuFormState {
  name: string;
  category: string;
  course: string;
  /** "" is "Nessuna ricetta": the item is saved unmapped (recipeKey null). */
  recipeKey: string;
  price: string;
  vatRate: string;
  position: string;
  available: boolean;
  active: boolean;
  /** "Venduto a peso" (P2-0b): the price is then per 100 g and the reference portion below is required. */
  byWeight: boolean;
  /** The grams that count as one portion of the recipe; read only while `byWeight` is on. */
  portionWeightG: string;
}

export type MenuFormField =
  "name" | "category" | "price" | "vatRate" | "position" | "portionWeightG";
export type MenuFormErrors = Partial<Record<MenuFormField, string>>;

// Digits, then optionally a comma or dot and 1 or 2 decimals: what a person types for a price.
const PRICE = /^\d+(?:[.,]\d{1,2})?$/;

/** A price as typed: required, up to 2 decimals, 0 to 10 000. An empty field is not a price. */
export function parsePrice(text: string): DecimalResult {
  const trimmed = text.trim();
  if (!PRICE.test(trimmed)) return { ok: false };
  const value = Number(trimmed.replace(",", "."));
  return value > MENU_PRICE_MAX ? { ok: false } : { ok: true, value };
}

/**
 * The "Venduto a peso" switch. A change of unit empties the price, so the owner types a deliberate new one: 17,00 € per portion must
 * never silently become 17,00 € per 100 g (plan P-3). A save without it gets the ordinary price error.
 */
export function setByWeight(state: MenuFormState, byWeight: boolean): MenuFormState {
  return state.byWeight === byWeight ? state : { ...state, byWeight, price: "" };
}

/** The empty "Nuovo piatto" form: only the VAT rate is pre-filled, from the tenant's default. */
export function emptyMenuForm(defaultVatRate: number | null): MenuFormState {
  return {
    name: "",
    category: "",
    course: "secondi",
    recipeKey: "",
    price: "",
    vatRate: defaultVatRate === null ? "" : String(defaultVatRate),
    position: "",
    available: true,
    active: true,
    byWeight: false,
    portionWeightG: "",
  };
}

/** The form of an existing item: the price with a decimal comma and two decimals. */
export function formFromItem(item: MenuItem): MenuFormState {
  return {
    name: item.name,
    category: item.category,
    course: item.course,
    recipeKey: item.recipeKey ?? "",
    price: item.price.toFixed(2).replace(".", ","),
    vatRate: String(item.vatRate),
    position: String(item.position),
    available: item.available,
    active: item.active,
    byWeight: item.priceUnit === "etto",
    portionWeightG: item.portionWeightG === null ? "" : String(item.portionWeightG),
  };
}

type Validated =
  | {
      ok: true;
      name: string;
      category: string;
      price: number;
      vatRate: number;
      position: number | null;
      portionWeightG: number | null;
    }
  | { ok: false; errors: MenuFormErrors };

function validate(state: MenuFormState, locale: Locale): Validated {
  const errors: MenuFormErrors = {};
  const name = state.name.trim();
  const category = state.category.trim();
  if (name === "" || name.length > MENU_NAME_MAX) {
    errors.name = t("menu.form.error.name", {}, locale);
  }
  if (category === "" || category.length > MENU_CATEGORY_MAX) {
    errors.category = t("menu.form.error.category", {}, locale);
  }
  const price = parsePrice(state.price);
  if (!price.ok) errors.price = t("menu.form.error.price", {}, locale);
  const vatRate = Number(state.vatRate);
  const vatOk = state.vatRate.trim() !== "" && (VAT_RATES as readonly number[]).includes(vatRate);
  if (!vatOk) errors.vatRate = t("menu.form.error.vatRate", {}, locale);
  let position: number | null = null;
  if (state.position.trim() !== "") {
    if (/^\d{1,4}$/.test(state.position.trim()) && Number(state.position) <= MENU_POSITION_MAX) {
      position = Number(state.position);
    } else {
      errors.position = t("menu.form.error.position", {}, locale);
    }
  }
  let portionWeightG: number | null = null;
  if (state.byWeight) {
    const text = state.portionWeightG.trim();
    const grams = /^\d{1,5}$/.test(text) ? Number(text) : NaN;
    if (grams >= PORTION_WEIGHT_MIN_G && grams <= PORTION_WEIGHT_MAX_G) portionWeightG = grams;
    else errors.portionWeightG = t("menu.form.error.portionWeight", {}, locale);
  }
  if (Object.keys(errors).length > 0 || !price.ok || price.value === null) {
    return { ok: false, errors };
  }
  return { ok: true, name, category, price: price.value, vatRate, position, portionWeightG };
}

/** The POST body of a new item, or the field errors. */
export function bodyFromForm(
  state: MenuFormState,
  locale: Locale = DEFAULT_LOCALE,
): { ok: true; body: CreateMenuItemBody } | { ok: false; errors: MenuFormErrors } {
  const v = validate(state, locale);
  if (!v.ok) return v;
  return {
    ok: true,
    body: {
      name: v.name,
      category: v.category,
      course: state.course as CreateMenuItemBody["course"],
      recipeKey: state.recipeKey === "" ? null : state.recipeKey,
      price: v.price,
      vatRate: v.vatRate,
      ...(v.position === null ? {} : { position: v.position }),
      available: state.available,
      // Only a weighted dish names its unit; the database defaults to the portion.
      ...(state.byWeight ? { priceUnit: "etto", portionWeightG: v.portionWeightG } : {}),
    },
  };
}

/** The PATCH body of an edit: only the fields that differ from the item. An empty patch means nothing to send. */
export function patchFromForm(
  state: MenuFormState,
  item: MenuItem,
  locale: Locale = DEFAULT_LOCALE,
): { ok: true; patch: UpdateMenuItemBody } | { ok: false; errors: MenuFormErrors } {
  const v = validate(state, locale);
  if (!v.ok) return v;
  const patch: UpdateMenuItemBody = {};
  if (v.name !== item.name) patch.name = v.name;
  if (v.category !== item.category) patch.category = v.category;
  if (state.course !== item.course) patch.course = state.course as UpdateMenuItemBody["course"];
  const recipeKey = state.recipeKey === "" ? null : state.recipeKey;
  if (recipeKey !== item.recipeKey) patch.recipeKey = recipeKey;
  const wasWeighted = item.priceUnit === "etto";
  if (state.byWeight !== wasWeighted) {
    // A unit switch carries its price (and, to weight, the reference portion) in the same request (plan P-3).
    patch.priceUnit = state.byWeight ? "etto" : "portion";
    patch.price = v.price;
    if (state.byWeight) patch.portionWeightG = v.portionWeightG;
  } else {
    if (v.price !== item.price) patch.price = v.price;
    if (state.byWeight && v.portionWeightG !== item.portionWeightG) {
      patch.portionWeightG = v.portionWeightG;
    }
  }
  if (v.vatRate !== item.vatRate) patch.vatRate = v.vatRate;
  if (v.position !== null && v.position !== item.position) patch.position = v.position;
  if (state.available !== item.available) patch.available = state.available;
  if (state.active !== item.active) patch.active = state.active;
  return { ok: true, patch };
}
