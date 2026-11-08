"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Muted,
  Select,
  SubHeading,
  TextInput,
} from "@/components/ui";
import { t, type MessageKey } from "@/lib/i18n";
import {
  addDate,
  draftFromSettings,
  NUMBER_FIELDS,
  removeDate,
  settingsBody,
  slugPreview,
  SLOT_CHOICES,
  toggleWeekday,
  WEEKDAYS,
  weekdayLabel,
  type ServiceDraft,
  type SettingsDraft,
} from "@/lib/reservations/settings-view";
import type { ReservationSettings } from "@/server/reservations/output";
import type { ReservationSettingsBody } from "@/server/reservations/schemas";

const LIMIT_FIELDS = [
  ["coversPerSlot", "reservations.service.coversPerSlot"],
  ["reservationsPerSlot", "reservations.service.reservationsPerSlot"],
  ["coversPerService", "reservations.service.coversPerService"],
] as const;

/**
 * "Prenotazioni online": the switch (disabled, with the checklist of what is missing, until the server says the page is ready), the page address with a preview, the
 * numbers, the closed days, the booking times and limits of each service and the privacy details. It sends only the fields the owner changed; every value and every bound is
 * the server's (the card checks the obvious mistakes first and shows the server's own sentence for the field).
 */
export function ReservationsCard({
  settings,
  origin,
  busy,
  error,
  onSave,
}: {
  settings: ReservationSettings;
  origin: string;
  busy: boolean;
  error: string | null;
  onSave: (body: ReservationSettingsBody) => void;
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromSettings(settings));
  const [newDate, setNewDate] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const change = (patch: Partial<SettingsDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setNote(null);
  };
  const changeService = (index: number, patch: Partial<ServiceDraft>) =>
    change({ services: draft.services.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  function save() {
    const result = settingsBody(settings, draft);
    if (!result.ok) {
      setNote(null);
      return setLocalError(t(`reservationError.settings.${result.reason}` as MessageKey));
    }
    setLocalError(null);
    if (Object.keys(result.body).length === 0) return setNote(t("reservations.unchanged"));
    setNote(null);
    onSave(result.body);
  }

  const preview = slugPreview(origin, draft.publicSlug);
  // A page that is on can always be switched off; one that is off needs the server's "ready".
  const switchDisabled = busy || (!settings.ready && !settings.enabled);

  return (
    <Card role="group" aria-label={t("reservations.title")} className="flex flex-col gap-3">
      <SubHeading>{t("reservations.title")}</SubHeading>
      <Muted>{t("reservations.hint")}</Muted>
      <Checkbox
        name="reservationsEnabled"
        label={t("reservations.enabled")}
        checked={draft.enabled}
        disabled={switchDisabled}
        onChange={(event) => change({ enabled: event.target.checked })}
      />
      {settings.notReady.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-bold">{t("reservations.checklist.title")}</p>
          <ul aria-label={t("reservations.checklist.title")} className="list-disc pl-6">
            {settings.notReady.map((reason) => (
              <li key={reason}>{t(`reservations.checklist.${reason}` as MessageKey)}</li>
            ))}
          </ul>
        </div>
      )}

      <Field label={t("reservations.slug")}>
        <TextInput
          name="reservationsSlug"
          value={draft.publicSlug}
          disabled={busy}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => change({ publicSlug: event.target.value })}
        />
      </Field>
      {preview ? (
        <p data-slug-preview className="num [overflow-wrap:anywhere]">
          {preview}
        </p>
      ) : (
        <Muted>{t("reservations.slug.hint")}</Muted>
      )}
      <Field label={t("reservations.venuePhone")}>
        <TextInput
          name="reservationsVenuePhone"
          type="tel"
          value={draft.venuePhone}
          disabled={busy}
          onChange={(event) => change({ venuePhone: event.target.value })}
        />
      </Field>
      <Muted>{t("reservations.venuePhone.hint")}</Muted>

      {NUMBER_FIELDS.map((field) =>
        field.key === "slotMinutes" ? (
          <Field key={field.key} label={t(field.label)}>
            <Select
              name="reservationsSlotMinutes"
              value={draft.slotMinutes}
              disabled={busy}
              onChange={(event) => change({ slotMinutes: event.target.value })}
            >
              {SLOT_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field key={field.key} label={t(field.label)}>
            <TextInput
              name={`reservations-${field.key}`}
              type="text"
              inputMode="numeric"
              value={draft[field.key]}
              disabled={busy}
              onChange={(event) => change({ [field.key]: event.target.value })}
            />
          </Field>
        ),
      )}

      <fieldset className="flex flex-col gap-1 border-t border-rule pt-3">
        <legend className="font-bold">{t("reservations.closedWeekdays")}</legend>
        {WEEKDAYS.map((day) => (
          <Checkbox
            key={day}
            name={`reservationsClosedWeekday${day}`}
            label={weekdayLabel(day)}
            checked={draft.closedWeekdays.includes(day)}
            disabled={busy}
            onChange={() => change({ closedWeekdays: toggleWeekday(draft.closedWeekdays, day) })}
          />
        ))}
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-rule pt-3">
        <p className="font-bold">{t("reservations.closedDates")}</p>
        {draft.closedDates.length === 0 ? (
          <Muted>{t("reservations.closedDates.none")}</Muted>
        ) : (
          <ul className="flex flex-col gap-2">
            {draft.closedDates.map((date) => (
              <li key={date} className="flex flex-wrap items-center gap-3">
                <span className="num">{date}</span>
                <Button
                  variant="quiet"
                  aria-label={t("reservations.closedDates.removeAria", { date })}
                  disabled={busy}
                  onClick={() => change({ closedDates: removeDate(draft.closedDates, date) })}
                >
                  {t("reservations.closedDates.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Field label={t("reservations.closedDates.new")}>
          <TextInput
            name="reservationsNewDate"
            type="date"
            value={newDate}
            disabled={busy}
            onChange={(event) => setNewDate(event.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          disabled={busy || newDate === ""}
          onClick={() => {
            change({ closedDates: addDate(draft.closedDates, newDate) });
            setNewDate("");
          }}
          className="self-start"
        >
          {t("reservations.closedDates.add")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-rule pt-3">
        <p className="font-bold">{t("reservations.services")}</p>
        <Muted>{t("reservations.service.limitHint")}</Muted>
        {draft.services.map((service, index) => (
          <div key={service.key} className="flex flex-col gap-3 rounded-lg bg-sunk p-3">
            <Checkbox
              name={`reservationsService${service.key}Online`}
              label={t("reservations.service.online", { name: service.name })}
              checked={service.online}
              disabled={busy}
              onChange={(event) => changeService(index, { online: event.target.checked })}
            />
            <Field label={t("reservations.service.first", { name: service.name })}>
              <TextInput
                name={`reservationsService${service.key}First`}
                type="time"
                value={service.firstSeating}
                disabled={busy}
                onChange={(event) => changeService(index, { firstSeating: event.target.value })}
              />
            </Field>
            <Field label={t("reservations.service.last", { name: service.name })}>
              <TextInput
                name={`reservationsService${service.key}Last`}
                type="time"
                value={service.lastSeating}
                disabled={busy}
                onChange={(event) => changeService(index, { lastSeating: event.target.value })}
              />
            </Field>
            {LIMIT_FIELDS.map(([key, label]) => (
              <Field key={key} label={t(label, { name: service.name })}>
                <TextInput
                  name={`reservationsService${service.key}${key}`}
                  type="text"
                  inputMode="numeric"
                  value={service[key]}
                  disabled={busy}
                  onChange={(event) => changeService(index, { [key]: event.target.value })}
                />
              </Field>
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-rule pt-3">
        <p className="font-bold">{t("reservations.privacy")}</p>
        <Field label={t("reservations.privacyName")}>
          <TextInput
            name="reservationsPrivacyName"
            value={draft.privacyControllerName}
            disabled={busy}
            onChange={(event) => change({ privacyControllerName: event.target.value })}
          />
        </Field>
        {settings.privacy.controllerVat && (
          <p className="num">{t("reservations.vat", { vat: settings.privacy.controllerVat })}</p>
        )}
        <Field label={t("reservations.privacyEmail")}>
          <TextInput
            name="reservationsPrivacyEmail"
            type="email"
            value={draft.privacyContactEmail}
            disabled={busy}
            onChange={(event) => change({ privacyContactEmail: event.target.value })}
          />
        </Field>
      </div>

      <div aria-live="polite">
        <ErrorAlert message={localError ?? error} />
        {note && <Muted>{note}</Muted>}
      </div>
      <Button onClick={save} disabled={busy} className="self-start">
        {t("reservations.save")}
      </Button>
    </Card>
  );
}
