import { t } from "@/lib/i18n";
import { TYPE_FILTERS, type TypeFilter as Filter } from "@/lib/recipes/recipe-view";

// Text filters like /avvisi: the chosen one is bold and underlined, and aria-pressed says it too.
const BASE =
  "inline-flex min-h-tap items-center text-accent-ink underline-offset-4 transition-colors";
const ACTIVE = `${BASE} font-bold underline decoration-2`;
const IDLE = `${BASE} hover:underline`;

export function TypeFilter({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (next: Filter) => void;
}) {
  return (
    <div role="group" aria-label={t("recipes.filter.label")} className="flex flex-wrap gap-x-5">
      {TYPE_FILTERS.map((filter) => (
        <button
          key={filter}
          type="button"
          aria-pressed={value === filter}
          onClick={() => onChange(filter)}
          className={value === filter ? ACTIVE : IDLE}
        >
          {t(`recipes.filter.${filter}`)}
        </button>
      ))}
    </div>
  );
}
