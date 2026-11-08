"use client";

import { useState } from "react";
import { Button, Card, ErrorAlert, Field, Muted, Select, TextInput } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t } from "@/lib/i18n";
import {
  CONTACT_NAME_MAX,
  PARTY_MAX,
  PARTY_MIN,
  STAFF_PHONE_PATTERN,
  TIME_PATTERN,
} from "@/server/reservations/constants";
import type { StaffReservationBody } from "@/server/reservations/schemas";

/**
 * "Nuova prenotazione": a booking taken by phone. Name, phone, party, date and time are required; the e-mail is optional (with one, the customer gets the
 * confirmation). It starts accepted. There is no note field on purpose. The service is chosen here because the time must belong to it; the server checks that.
 */
export function NewReservationSheet({
  date,
  services,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  date: string;
  services: { key: string; name: string }[];
  busy: boolean;
  error: string | null;
  onSubmit: (body: StaffReservationBody) => void;
  onCancel: () => void;
}) {
  const heading = useFocusIntoView<HTMLHeadingElement>();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState("2");
  const [day, setDay] = useState(date);
  const [time, setTime] = useState("");
  const [email, setEmail] = useState("");
  const [serviceKey, setServiceKey] = useState(services[0]?.key ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    const trimmed = name.trim();
    const size = /^\d{1,2}$/.test(party.trim()) ? Number(party) : null;
    if (trimmed === "" || trimmed.length > CONTACT_NAME_MAX)
      return setLocalError(t("reservationError.field.name"));
    if (!STAFF_PHONE_PATTERN.test(phone.trim()))
      return setLocalError(t("reservationError.field.phone"));
    if (size === null || size < PARTY_MIN || size > PARTY_MAX)
      return setLocalError(t("reservationError.field.party"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setLocalError(t("reservationError.field.date"));
    if (!TIME_PATTERN.test(time)) return setLocalError(t("reservationError.field.time"));
    const mail = email.trim();
    if (mail !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail))
      return setLocalError(t("reservationError.field.email"));
    if (serviceKey === "") return setLocalError(t("reservationError.field.service"));
    setLocalError(null);
    const body: StaffReservationBody = {
      date: day,
      time,
      serviceKey,
      party: size,
      name: trimmed,
      phone: phone.trim(),
    };
    if (mail !== "") body.email = mail;
    onSubmit(body);
  }

  return (
    <Card role="group" aria-label={t("reservations.new.title")} className="flex flex-col gap-3">
      <h2
        ref={heading}
        tabIndex={-1}
        className="font-display text-[1.5rem] leading-tight font-semibold [overflow-wrap:anywhere]"
      >
        {t("reservations.new.title")}
      </h2>
      <Muted>{t("reservations.new.hint")}</Muted>
      <Field label={t("reservations.field.name")}>
        <TextInput
          name="newName"
          value={name}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label={t("reservations.field.phone")}>
        <TextInput
          name="newPhone"
          type="tel"
          value={phone}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setPhone(event.target.value)}
        />
      </Field>
      <Field label={t("reservations.field.party")}>
        <TextInput
          name="newParty"
          type="text"
          inputMode="numeric"
          value={party}
          disabled={busy}
          onChange={(event) => setParty(event.target.value)}
        />
      </Field>
      <Field label={t("reservations.field.date")}>
        <TextInput
          name="newDate"
          type="date"
          value={day}
          disabled={busy}
          onChange={(event) => setDay(event.target.value)}
        />
      </Field>
      <Field label={t("reservations.field.time")}>
        <TextInput
          name="newTime"
          type="time"
          value={time}
          disabled={busy}
          onChange={(event) => setTime(event.target.value)}
        />
      </Field>
      <Field label={t("reservations.field.service")}>
        <Select
          name="newService"
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
      <Field label={t("reservations.field.emailOptional")}>
        <TextInput
          name="newEmail"
          type="email"
          value={email}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <div aria-live="polite">
        <ErrorAlert message={localError ?? error} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={busy}>
          {t("reservations.new.submit")}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
      </div>
    </Card>
  );
}
