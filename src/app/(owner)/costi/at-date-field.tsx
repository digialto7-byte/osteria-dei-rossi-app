"use client";

import { useCallback, useEffect, useState } from "react";
import { Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { venueDate } from "@/lib/time/venue-date";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The "Al giorno" date of the cost screens, kept in the address (`?at=YYYY-MM-DD`) so a link opens
 * the same day. Today (the default) is no parameter at all. The server checks the date; this only
 * keeps it. `ready` turns true once the address was read, so the first request already uses it.
 */
export function useAtDate() {
  const [at, setAt] = useState("");
  const [today, setToday] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The address and the clock exist only in the browser; they are read once, when the page opens.
    /* eslint-disable react-hooks/set-state-in-effect */
    setToday(venueDate(new Date()));
    const fromAddress = new URLSearchParams(window.location.search).get("at");
    if (fromAddress && ISO_DATE.test(fromAddress)) setAt(fromAddress);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const change = useCallback(
    (next: string) => {
      const value = next === today ? "" : next;
      setAt(value);
      window.history.replaceState(
        null,
        "",
        value ? `${window.location.pathname}?at=${value}` : window.location.pathname,
      );
    },
    [today],
  );

  return { ready, today, at, change, query: at ? `?at=${at}` : "" };
}

export function AtDateField({
  value,
  max,
  onChange,
}: {
  value: string;
  max: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={t("costs.date.label")} hint={t("costs.date.hint")}>
      <TextInput
        type="date"
        value={value}
        max={max || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
