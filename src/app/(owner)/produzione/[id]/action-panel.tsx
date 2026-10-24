"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, Select, TextInput } from "@/components/ui";
import { formatCount, parseUsedQty, parseWholeNumber, qtyToInput } from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import {
  BATCH_WASTE_REASONS,
  batchReasonLabel,
  type BatchWasteReason,
} from "@/server/batches/reasons";

export type ActionKind = "adjust" | "discard" | "split";

interface PanelProps {
  can: { adjust: boolean; discard: boolean; split: boolean };
  remaining: number;
  /** Hours to the use-by, to prefill the split; null when there is none to suggest. */
  hoursLeft: number | null;
  locations: readonly { id: string; name: string }[];
  /** The batch's own location, the starting choice of the split form. */
  locationId?: string;
  busy: boolean;
  /** The server's Italian message for the last failed action. */
  error: string | null;
  onAdjust: (counted: number) => Promise<boolean>;
  onDiscard: (portions: number, reason: BatchWasteReason) => Promise<boolean>;
  onSplit: (portions: number, hoursFromNow: number, locationId?: string) => Promise<boolean>;
  /** Opens a form straight away (tests render the forms this way). */
  initialOpen?: ActionKind | null;
  locale?: Locale;
}

const FORM = "flex w-full flex-col gap-3 rounded-lg border border-rule p-3";

/**
 * "Conta", "Scarta" and "Dividi": three secondary buttons (each shown only when the batch `can` do it), and under
 * them the one form that is open, with its one primary button. The forms only read what was typed; the limits, the
 * remaining portions, the use-by and the state are the database's, and its Italian errors come back as `error`.
 */
export function ActionPanel({
  can,
  remaining,
  hoursLeft,
  locations,
  locationId,
  busy,
  error,
  onAdjust,
  onDiscard,
  onSplit,
  initialOpen = null,
  locale = DEFAULT_LOCALE,
}: PanelProps) {
  const [open, setOpen] = useState<ActionKind | null>(initialOpen);
  const kinds = (["adjust", "discard", "split"] as const).filter((kind) => can[kind]);
  const close = () => setOpen(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {kinds.map((kind) => (
          <Button
            key={kind}
            variant="secondary"
            aria-expanded={open === kind}
            onClick={() => setOpen(open === kind ? null : kind)}
          >
            {t(`batch.action.${kind}`, {}, locale)}
          </Button>
        ))}
      </div>
      {open === "adjust" && (
        <AdjustForm
          expected={remaining}
          busy={busy}
          error={error}
          locale={locale}
          onSubmit={async (counted) => {
            if (await onAdjust(counted)) close();
          }}
        />
      )}
      {open === "discard" && (
        <DiscardForm
          remaining={remaining}
          busy={busy}
          error={error}
          locale={locale}
          onSubmit={async (portions, reason) => {
            if (await onDiscard(portions, reason)) close();
          }}
        />
      )}
      {open === "split" && (
        <SplitForm
          locations={locations}
          locationId={locationId}
          hoursLeft={hoursLeft}
          busy={busy}
          error={error}
          locale={locale}
          onSubmit={async (portions, hours, location) => {
            if (await onSplit(portions, hours, location)) close();
          }}
        />
      )}
    </div>
  );
}

function AdjustForm({
  expected,
  busy,
  error,
  locale,
  onSubmit,
}: {
  expected: number;
  busy: boolean;
  error: string | null;
  locale: Locale;
  onSubmit: (counted: number) => Promise<void>;
}) {
  const [counted, setCounted] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseUsedQty(counted);
    if (value === null) return setProblem(t("batchError.count_invalid", {}, locale));
    setProblem(null);
    await onSubmit(value);
  };
  return (
    <form onSubmit={submit} aria-label={t("batch.adjust.title", {}, locale)} className={FORM}>
      <Field
        label={t("batch.adjust.counted", {}, locale)}
        hint={t("batch.adjust.expected", { count: formatCount(expected, locale) }, locale)}
      >
        <TextInput
          name="counted"
          inputMode="decimal"
          autoComplete="off"
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
        />
      </Field>
      <ErrorAlert message={problem ?? error} />
      <div>
        <Button type="submit" disabled={busy}>
          {t("batch.adjust.title", {}, locale)}
        </Button>
      </div>
    </form>
  );
}

function DiscardForm({
  remaining,
  busy,
  error,
  locale,
  onSubmit,
}: {
  remaining: number;
  busy: boolean;
  error: string | null;
  locale: Locale;
  onSubmit: (portions: number, reason: BatchWasteReason) => Promise<void>;
}) {
  const [portions, setPortions] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseUsedQty(portions);
    if (value === null || value === 0) {
      return setProblem(t("batch.discard.portionsInvalid", {}, locale));
    }
    if (!(BATCH_WASTE_REASONS as readonly string[]).includes(reason)) {
      return setProblem(t("batchError.reason_invalid", {}, locale));
    }
    setProblem(null);
    await onSubmit(value, reason as BatchWasteReason);
  };
  return (
    <form onSubmit={submit} aria-label={t("batch.discard.title", {}, locale)} className={FORM}>
      <Field label={t("batch.discard.portions", {}, locale)}>
        <TextInput
          name="portions"
          inputMode="decimal"
          autoComplete="off"
          value={portions}
          onChange={(event) => setPortions(event.target.value)}
        />
      </Field>
      <div>
        <Button variant="quiet" onClick={() => setPortions(qtyToInput(remaining))}>
          {t("batch.discard.all", { count: formatCount(remaining, locale) }, locale)}
        </Button>
      </div>
      <Field label={t("batch.discard.reason", {}, locale)}>
        <Select name="reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="">{t("batch.discard.reasonPlaceholder", {}, locale)}</option>
          {BATCH_WASTE_REASONS.map((code) => (
            <option key={code} value={code}>
              {batchReasonLabel(code, locale)}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorAlert message={problem ?? error} />
      <div>
        <Button type="submit" disabled={busy}>
          {t("batch.discard.title", {}, locale)}
        </Button>
      </div>
    </form>
  );
}

function SplitForm({
  locations,
  locationId,
  hoursLeft,
  busy,
  error,
  locale,
  onSubmit,
}: {
  locations: readonly { id: string; name: string }[];
  locationId?: string;
  hoursLeft: number | null;
  busy: boolean;
  error: string | null;
  locale: Locale;
  onSubmit: (portions: number, hoursFromNow: number, locationId?: string) => Promise<void>;
}) {
  const several = locations.length >= 2;
  const [portions, setPortions] = useState("");
  const [hours, setHours] = useState(hoursLeft === null ? "" : String(hoursLeft));
  const [location, setLocation] = useState(locationId ?? locations[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const count = parseWholeNumber(portions);
    if (count === null || count < 1)
      return setProblem(t("batchError.portions_invalid", {}, locale));
    const duration = parseWholeNumber(hours);
    if (duration === null || duration < 1) {
      return setProblem(t("batchError.shelf_life_invalid", {}, locale));
    }
    setProblem(null);
    await onSubmit(count, duration, several && location ? location : undefined);
  };
  return (
    <form onSubmit={submit} aria-label={t("batch.split.title", {}, locale)} className={FORM}>
      <Field label={t("batch.split.portions", {}, locale)}>
        <TextInput
          name="portions"
          inputMode="numeric"
          autoComplete="off"
          value={portions}
          onChange={(event) => setPortions(event.target.value)}
        />
      </Field>
      {several && (
        <Field label={t("batch.split.location", {}, locale)}>
          <Select
            name="location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          >
            {locations.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field
        label={t("batch.split.hours", {}, locale)}
        hint={t("batch.split.hoursHint", {}, locale)}
      >
        <TextInput
          name="hours"
          inputMode="numeric"
          autoComplete="off"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
        />
      </Field>
      <ErrorAlert message={problem ?? error} />
      <div>
        <Button type="submit" disabled={busy}>
          {t("batch.split.title", {}, locale)}
        </Button>
      </div>
    </form>
  );
}
