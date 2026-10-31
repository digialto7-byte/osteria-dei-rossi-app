"use client";

import { useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { formatEur } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import { parseEuroInput } from "@/lib/money/parse";

/**
 * The sheet that asks for the price of the day (M23 plan §3.5): the plate, the menu price when it is known, an optional "Prezzo del giorno" and
 * "Conferma". What the owner types is read by parseEuroInput (a decimal string, no float arithmetic); an empty field means "no temporary price".
 * Whether the price is allowed (above 0, not above the menu price) is the database's call: its refusal comes back as `error`.
 */
export function PushSheet({
  plateName,
  menuPrice,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  plateName: string;
  menuPrice: number | null;
  busy: boolean;
  error: string | null;
  onConfirm: (price: number | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [typed, setTyped] = useState<string | null>(null);

  function confirm() {
    if (text.trim() === "") {
      setTyped(null);
      return onConfirm(null);
    }
    const parsed = parseEuroInput(text);
    // Zero and negative are not prices; the database says so too, but the owner should not wait for it.
    if (parsed === null || Number(parsed) <= 0) {
      return setTyped(t("pushError.push_price_invalid"));
    }
    setTyped(null);
    onConfirm(Number(parsed));
  }

  const message = typed ?? error;
  return (
    <fieldset className="flex flex-col gap-3 rounded-card border border-rule bg-sunk p-3">
      <legend className="px-1 font-bold">{plateName}</legend>
      {menuPrice !== null ? (
        <p className="num">{t("push.sheet.menuPrice", { price: formatEur(menuPrice) })}</p>
      ) : null}
      <Field label={t("push.sheet.price")} hint={t("push.sheet.priceHint")}>
        <TextInput
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <div aria-live="polite">{message ? <p className="text-danger">{message}</p> : null}</div>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={confirm}>
          {t("push.sheet.confirm")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("push.sheet.cancel")}
        </Button>
      </div>
    </fieldset>
  );
}
