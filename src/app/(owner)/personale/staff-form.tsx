"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert, Field, SubHeading, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { sanitizePin } from "@/lib/staff-auth/pin-view";
import { validateStaffForm } from "@/lib/staff-auth/staff-form";

/** "Aggiungi persona": name, role, PIN twice. The server decides whether the PIN is too simple. */
export function StaffForm({ onAdded }: { onAdded: (name: string) => void }) {
  const [role, setRole] = useState("waiter");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const checked = validateStaffForm({
      name: String(data.get("name") ?? ""),
      role,
      pin: String(data.get("pin") ?? ""),
      repeat: String(data.get("repeat") ?? ""),
    });
    if (!checked.ok) return setMessage(checked.message);
    setBusy(true);
    const result = await apiJson("/api/users", { method: "POST", body: checked.value });
    setBusy(false);
    if (!result.ok) return setMessage(result.error.message);
    setMessage(null);
    form.reset();
    onAdded(checked.value.displayName);
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <SubHeading>{t("staff.addTitle")}</SubHeading>
        <Field label={t("staff.name")} hint={t("staff.nameHint")}>
          <TextInput name="name" type="text" autoComplete="off" maxLength={60} required />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[0.9375rem] font-bold text-ink">{t("staff.role")}</legend>
          {(["waiter", "chef"] as const).map((value) => (
            <label key={value} className="flex min-h-tap items-center gap-3">
              <input
                type="radio"
                name="role"
                value={value}
                checked={role === value}
                onChange={() => setRole(value)}
                className="size-5"
              />
              {t(`pin.role.${value}`)}
            </label>
          ))}
        </fieldset>
        <Field label={t("staff.pin")}>
          <TextInput
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            pattern="[0-9]{4}"
            onChange={(event) => (event.target.value = sanitizePin(event.target.value))}
            required
          />
        </Field>
        <Field label={t("staff.pinRepeat")}>
          <TextInput
            name="repeat"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            pattern="[0-9]{4}"
            onChange={(event) => (event.target.value = sanitizePin(event.target.value))}
            required
          />
        </Field>
        <ErrorAlert message={message} />
        <Button type="submit" disabled={busy}>
          {t("staff.add")}
        </Button>
      </form>
    </Card>
  );
}
