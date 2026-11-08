"use client";

import { useState } from "react";
import { Button, Card, ErrorAlert, Field, Select, TextInput } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t } from "@/lib/i18n";
import { rowTitle, type RowView } from "@/lib/reservations/day-view";
import { PARTY_MAX, PARTY_MIN, TIME_PATTERN } from "@/server/reservations/constants";
import type { MoveBody } from "@/server/reservations/schemas";

/**
 * "Sposta": a new date, time, service and party. Staff may move inside the lead time and above the online maximum; the tables are released and the booking is placed
 * again (an accepted one then needs its tables). Whether the slot is allowed is the server's answer (422 slot_unavailable with its reason).
 */
export function MoveSheet({
  row,
  services,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  row: RowView;
  services: { key: string; name: string }[];
  busy: boolean;
  error: string | null;
  onSubmit: (body: MoveBody) => void;
  onCancel: () => void;
}) {
  const heading = useFocusIntoView<HTMLHeadingElement>();
  const [date, setDate] = useState(row.businessDate);
  const [time, setTime] = useState(row.time);
  const [party, setParty] = useState(String(row.party));
  const [serviceKey, setServiceKey] = useState(row.serviceKey);
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    const size = /^\d{1,2}$/.test(party.trim()) ? Number(party) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setLocalError(t("reservationError.field.date"));
    if (!TIME_PATTERN.test(time)) return setLocalError(t("reservationError.field.time"));
    if (size === null || size < PARTY_MIN || size > PARTY_MAX) {
      return setLocalError(t("reservationError.field.party"));
    }
    setLocalError(null);
    onSubmit({ date, time, serviceKey, party: size });
  }

  return (
    <Card role="group" aria-label={t("reservations.move.title")} className="flex flex-col gap-3">
      <h2
        ref={heading}
        tabIndex={-1}
        className="font-display text-[1.5rem] leading-tight font-semibold [overflow-wrap:anywhere]"
      >
        {t("reservations.move.title")}
      </h2>
      <p className="[overflow-wrap:anywhere]">{rowTitle(row)}</p>
      <Field label={t("reservations.field.date")}>
        <TextInput
          name="moveDate"
          type="date"
          value={date}
          disabled={busy}
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>
      <Field label={t("reservations.field.time")}>
        <TextInput
          name="moveTime"
          type="time"
          value={time}
          disabled={busy}
          onChange={(event) => setTime(event.target.value)}
        />
      </Field>
      <Field label={t("reservations.field.service")}>
        <Select
          name="moveService"
          value={serviceKey}
          disabled={busy}
          onChange={(event) => setServiceKey(event.target.value)}
        >
          {services.map((service) => (
            <option key={service.key} value={service.key}>
              {service.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("reservations.field.party")}>
        <TextInput
          name="moveParty"
          type="text"
          inputMode="numeric"
          value={party}
          disabled={busy}
          onChange={(event) => setParty(event.target.value)}
        />
      </Field>
      <div aria-live="polite">
        <ErrorAlert message={localError ?? error} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={busy}>
          {t("reservations.move.submit")}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
      </div>
    </Card>
  );
}
