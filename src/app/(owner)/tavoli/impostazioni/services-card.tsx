"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  ErrorAlert,
  Field,
  Muted,
  SubHeading,
  TextInput,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  rowsFromPeriods,
  rowsToBody,
  servicesHint,
  servicesPreview,
  type ServiceRow,
} from "@/lib/services/services-view";
import { SERVICE_MAX_PERIODS } from "@/server/services/constants";
import type { ServicePeriods } from "@/server/services/output";
import type { ServicesBody } from "@/server/services/schemas";

/**
 * The service periods (Pranzo, Cena, ...): a name and a start time per service. A service runs until the next one starts and the last one until
 * the day's cut-off, so there are no gaps and no overlaps. The preview line is the server's; saving applies to tables opened from now on.
 */
export function ServicesCard({
  services,
  busy,
  error,
  onSave,
}: {
  services: ServicePeriods;
  busy: boolean;
  error: string | null;
  onSave: (body: ServicesBody) => void;
}) {
  const [rows, setRows] = useState<ServiceRow[]>(() => rowsFromPeriods(services.periods));
  const [localError, setLocalError] = useState<string | null>(null);

  function change(index: number, patch: Partial<ServiceRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function save() {
    const body = rowsToBody(rows);
    if (!body) return setLocalError(t("services.error.incomplete"));
    setLocalError(null);
    onSave(body);
  }

  return (
    <Card role="group" aria-label={t("services.title")} className="flex flex-col gap-3">
      <SubHeading>{t("services.title")}</SubHeading>
      {services.isDefault && <Badge tone="neutral">{t("services.default")}</Badge>}
      <p data-services-preview className="num">
        {servicesPreview(services.periods)}
      </p>
      <Muted>{servicesHint(services.periods)}</Muted>
      {rows.map((row, index) => (
        <div key={index} className="flex flex-col gap-3 border-t border-rule pt-3">
          <Field label={t("services.field.name", { n: index + 1 })}>
            <TextInput
              name={`serviceName${index}`}
              value={row.name}
              disabled={busy}
              onChange={(event) => change(index, { name: event.target.value })}
            />
          </Field>
          <Field label={t("services.field.start", { n: index + 1 })}>
            <TextInput
              name={`serviceStart${index}`}
              type="time"
              value={row.startsAt}
              disabled={busy}
              onChange={(event) => change(index, { startsAt: event.target.value })}
            />
          </Field>
          {rows.length > 1 && (
            <Button
              variant="quiet"
              aria-label={t("services.removeAria", { n: index + 1 })}
              disabled={busy}
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              className="self-start"
            >
              {t("services.remove")}
            </Button>
          )}
        </div>
      ))}
      <div aria-live="polite">
        <ErrorAlert message={localError ?? error} />
      </div>
      <div className="flex flex-wrap gap-3">
        {rows.length < SERVICE_MAX_PERIODS && (
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() =>
              setRows((current) => [...current, { key: null, name: "", startsAt: "" }])
            }
          >
            {t("services.add")}
          </Button>
        )}
        <Button onClick={save} disabled={busy}>
          {t("services.save")}
        </Button>
      </div>
    </Card>
  );
}
