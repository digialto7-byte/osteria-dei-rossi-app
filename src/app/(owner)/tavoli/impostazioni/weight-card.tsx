"use client";

import { useState } from "react";
import { Button, Card, ErrorAlert, Field, Muted, SubHeading, TextInput } from "@/components/ui";
import { formatCount } from "@/lib/format/count";
import { t } from "@/lib/i18n";
import { weightBodyFromForm, weightFormFromRead } from "@/lib/tables/weight-form";
import type { WeightSettings } from "@/server/menu/output";
import type { WeightSettingsBody } from "@/server/menu/schemas";

/**
 * The largest weight one line may carry, in grams (P2-0b). The value, the default and the limits are the server's;
 * "Ripristina" sends null, which puts the default back. A change applies to lines added from now on.
 */
export function WeightCard({
  settings,
  busy,
  error,
  onSave,
}: {
  settings: WeightSettings;
  busy: boolean;
  error: string | null;
  onSave: (body: WeightSettingsBody) => void;
}) {
  const [form, setForm] = useState(() => weightFormFromRead(settings));
  const [localError, setLocalError] = useState<string | null>(null);

  function save() {
    const built = weightBodyFromForm(form, settings);
    if (!built.ok) return setLocalError(built.error);
    setLocalError(null);
    onSave(built.body);
  }

  function restore() {
    setLocalError(null);
    onSave({ weightMaxG: null });
  }

  return (
    <Card role="group" aria-label={t("tables.weight.title")} className="flex flex-col gap-3">
      <SubHeading>{t("tables.weight.title")}</SubHeading>
      <Field
        label={t("tables.weight.field")}
        hint={t("tables.weight.hint", {
          default: formatCount(settings.defaultWeightMaxG),
          min: formatCount(settings.settingMinG),
          max: formatCount(settings.settingMaxG),
          step: formatCount(settings.stepG),
        })}
      >
        <TextInput
          name="weightMaxG"
          type="text"
          inputMode="numeric"
          value={form.value}
          disabled={busy}
          onChange={(event) => setForm({ value: event.target.value })}
        />
      </Field>
      <Muted>{t("tables.weight.note")}</Muted>
      <ErrorAlert message={localError ?? error} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={save} disabled={busy}>
          {t("common.save")}
        </Button>
        <Button variant="quiet" onClick={restore} disabled={busy}>
          {t("tables.weight.restore")}
        </Button>
      </div>
    </Card>
  );
}
