"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { sanitizePin } from "@/lib/staff-auth/pin-view";
import { validatePinForm } from "@/lib/staff-auth/staff-form";
import type { StaffItem } from "@/lib/staff-auth/staff-view";

/** An inline bordered form to set or reset one person's PIN (POST /api/users/:id/pin). */
export function PinForm({
  item,
  onSaved,
  onCancel,
}: {
  item: StaffItem;
  onSaved: (item: StaffItem) => void;
  onCancel: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checked = validatePinForm({
      pin: String(data.get("pin") ?? ""),
      repeat: String(data.get("repeat") ?? ""),
    });
    if (!checked.ok) return setMessage(checked.message);
    setBusy(true);
    const result = await apiJson(`/api/users/${item.id}/pin`, {
      method: "POST",
      body: { pin: checked.value },
    });
    setBusy(false);
    if (!result.ok) return setMessage(result.error.message);
    onSaved(item);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-rule p-3">
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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {t("staff.savePin")}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          {t("staff.cancel")}
        </Button>
      </div>
    </form>
  );
}
