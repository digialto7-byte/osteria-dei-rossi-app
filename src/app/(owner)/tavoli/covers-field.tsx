"use client";

import { useId } from "react";
import { Button, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { nextCovers } from "@/lib/tables/table-view";
import { MAX_TABLE_COVERS } from "@/server/tables/constants";

/** The covers as typed: whole digits, 1 to 99. Anything else is not a number of covers. */
export function readCovers(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_TABLE_COVERS ? value : null;
}

/**
 * "Coperti" with a 44 px "−" and "+" either side of a numeric field. The buttons sit outside the label, so the
 * field's name is just "Coperti". The steps are clamped to 1 to 99 by nextCovers.
 */
export function CoversField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const step = (delta: number) =>
    onChange(String(nextCovers(Number.parseInt(value, 10) || 0, delta)));
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.9375rem] font-bold text-ink">
        {t("tables.covers.label")}
      </label>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          aria-label={t("tables.covers.less")}
          disabled={disabled}
          onClick={() => step(-1)}
        >
          −
        </Button>
        <TextInput
          id={id}
          name="covers"
          type="text"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          variant="secondary"
          aria-label={t("tables.covers.more")}
          disabled={disabled}
          onClick={() => step(1)}
        >
          +
        </Button>
      </div>
    </div>
  );
}
