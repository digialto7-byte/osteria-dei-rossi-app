"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * "Disattiva" with a question in front (UX plan P2-2): the first tap asks "Disattivare <nome>?", only "Conferma" calls
 * `onToggle`. "Riattiva" needs no question, as it loses nothing. The focus goes to "Annulla" when the question opens (the
 * safe answer) and back to the button when it closes.
 */
export function DeactivateButton({
  name,
  isActive,
  onToggle,
}: {
  name: string;
  isActive: boolean;
  onToggle: () => void | Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (asking ? cancel : trigger).current?.focus();
  }, [asking]);

  const setAskingWithFocus = (next: boolean) => {
    moveFocus.current = true;
    setAsking(next);
  };

  if (!isActive) {
    return (
      <Button variant="secondary" onClick={() => void onToggle()}>
        {t("common.reactivate")}
      </Button>
    );
  }
  if (!asking) {
    return (
      <Button ref={trigger} variant="secondary" onClick={() => setAskingWithFocus(true)}>
        {t("common.deactivate")}
      </Button>
    );
  }
  const question = t("common.deactivateAsk", { name });
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2">
      <p className="basis-full [overflow-wrap:anywhere]">{question}</p>
      <Button
        onClick={() => {
          setAsking(false);
          void onToggle();
        }}
      >
        {t("common.confirm")}
      </Button>
      <Button ref={cancel} variant="quiet" onClick={() => setAskingWithFocus(false)}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
