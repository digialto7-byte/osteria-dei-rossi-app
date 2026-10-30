"use client";

import { Button, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { addDays } from "@/lib/time/venue-date";

/** "Giorno precedente" and a date field: the owner can look at, and enter the register total of, an earlier business day. */
export function DayPicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Button variant="secondary" onClick={() => onChange(addDays(date, -1))}>
        {t("dayClose.picker.previous")}
      </Button>
      <Field label={t("dayClose.picker.label")}>
        <TextInput
          type="date"
          value={date}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
        />
      </Field>
    </div>
  );
}
