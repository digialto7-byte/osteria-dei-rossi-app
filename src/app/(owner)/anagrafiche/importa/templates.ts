import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locale";

export type ImportKind = "suppliers" | "ingredients" | "recipes";

/** The column list of each template, without the "Columns:" label (the hint adds it once). */
function columns(kind: ImportKind, locale: Locale): string {
  switch (kind) {
    case "suppliers":
      return "nome; partita_iva; giorni_pagamento";
    case "ingredients":
      return "nome; unita_base; categoria; a_magazzino; allergeni; giorni_conservazione";
    case "recipes":
      return t("import.recipesTemplate", {}, locale);
  }
}

/** The line under the kind picker: the label and the columns. */
export function templateHint(kind: ImportKind, locale?: Locale): string {
  return t("import.template", { columns: columns(kind, locale ?? "it") }, locale);
}
