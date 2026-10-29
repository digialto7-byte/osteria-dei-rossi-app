"use client";

import { Button, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";

/** The "Cerca per nome" box over a long list (UX plan P2-6). The page holds the query and narrows the rows. */
export function NameFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={t("filter.label")}>
      <TextInput
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        maxLength={80}
      />
    </Field>
  );
}

/** What a filter that matches nothing says, with the way back to the whole list. */
export function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p>{t("filter.none", { query: query.trim() })}</p>
      <Button variant="secondary" onClick={onClear}>
        {t("filter.clear")}
      </Button>
    </div>
  );
}
