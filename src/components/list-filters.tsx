"use client";

import { Button, Field, Select, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { hasActiveFilters, type ListFilters as Filters } from "@/lib/filters/list-filters";

export interface SupplierChoice {
  id: string;
  name: string;
}

/**
 * The "Filtri" group of Fatture and Pagamenti (M25b): "Dal" and "Al" (date fields, linked by min and max), "Fornitore" and, while a filter is
 * set, a 44 px "Azzera filtri". Controlled: the page owns the values (they come from the address) and decides what a change does. An
 * optional `hint` sits under the dates, for the date the list is filtered by.
 */
export function ListFilters({
  filters,
  suppliers,
  onChange,
  onReset,
  hint,
}: {
  filters: Required<Filters>;
  suppliers: readonly SupplierChoice[];
  onChange: (next: Required<Filters>) => void;
  onReset: () => void;
  hint?: string;
}) {
  return (
    <div role="group" aria-label={t("filters.title")} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("filters.from")}>
          <TextInput
            type="date"
            value={filters.dal ?? ""}
            max={filters.al ?? undefined}
            onChange={(event) => onChange({ ...filters, dal: event.target.value || null })}
          />
        </Field>
        <Field label={t("filters.to")}>
          <TextInput
            type="date"
            value={filters.al ?? ""}
            min={filters.dal ?? undefined}
            onChange={(event) => onChange({ ...filters, al: event.target.value || null })}
          />
        </Field>
      </div>
      {hint && <p className="text-sm leading-snug text-ink-muted">{hint}</p>}
      <Field label={t("filters.supplier")}>
        <Select
          value={filters.fornitore ?? ""}
          onChange={(event) => onChange({ ...filters, fornitore: event.target.value || null })}
        >
          <option value="">{t("filters.allSuppliers")}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>
      </Field>
      {hasActiveFilters(filters) && (
        <div>
          <Button variant="secondary" onClick={onReset}>
            {t("filters.reset")}
          </Button>
        </div>
      )}
    </div>
  );
}
