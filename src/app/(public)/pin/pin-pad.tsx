import type { FormEvent } from "react";
import { Button, ErrorAlert, Field, SubHeading, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { isCompletePin } from "@/lib/staff-auth/pin-view";

/** The PIN entry for one person. The parent owns the value and clears it after every answer. */
export function PinPad({
  name,
  pin,
  busy,
  message,
  onChange,
  onSubmit,
  onBack,
}: {
  name: string;
  pin: string;
  busy: boolean;
  message: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCompletePin(pin) && !busy) onSubmit();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <SubHeading>{t("pin.greeting", { name })}</SubHeading>
      <Field label={t("pin.field")}>
        <TextInput
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          pattern="[0-9]{4}"
          value={pin}
          onChange={(event) => onChange(event.target.value)}
          autoFocus
          required
        />
      </Field>
      <ErrorAlert message={message} />
      <Button type="submit" disabled={busy || !isCompletePin(pin)}>
        {t("pin.submit")}
      </Button>
      <Button type="button" variant="secondary" onClick={onBack}>
        {t("pin.change")}
      </Button>
    </form>
  );
}
