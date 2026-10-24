import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { DecimalResult } from "@/lib/numbers/parse-decimal";
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
}

export type MenuFormField = "name" | "category" | "price" | "vatRate" | "position";
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
  if (Object.keys(errors).length > 0 || !price.ok || price.value === null) {
    return { ok: false, errors };
  }
  return { ok: true, name, category, price: price.value, vatRate, position };
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
  if (v.price !== item.price) patch.price = v.price;
  if (v.vatRate !== item.vatRate) patch.vatRate = v.vatRate;
  if (v.position !== null && v.position !== item.position) patch.position = v.position;
  if (state.available !== item.available) patch.available = state.available;
  if (state.active !== item.active) patch.active = state.active;
  return { ok: true, patch };
}
