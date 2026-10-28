"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  Button,
  ErrorAlert,
  Field,
  Heading,
  linkClass,
  Muted,
  SuccessNote,
  TextInput,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { enrolFeedback, enrolSuccessText } from "@/lib/staff-auth/enrol-view";

type State = "idle" | "sending" | "done";

/** Enrols this browser as a venue device with the owner's code (POST /api/devices/enrol). */
export function EnrolForm({
  initialState = "idle",
  label: initialLabel = "",
}: {
  initialState?: State;
  label?: string;
}) {
  const [state, setState] = useState<State>(initialState);
  const [label, setLabel] = useState(initialLabel);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setState("sending");
    setMessage(null);
    const result = await apiJson<{ device: { label: string } }>("/api/devices/enrol", {
      method: "POST",
      body: { code },
    });
    if (result.ok) {
      setLabel(result.data.device.label);
      setState("done");
    } else {
      setMessage(enrolFeedback(result.error));
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="flex flex-col gap-4">
        <SuccessNote role="status">{enrolSuccessText(label)}</SuccessNote>
        <Link href="/pin" className={linkClass}>
          {t("enrol.toPin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Heading>{t("enrol.title")}</Heading>
      <Field label={t("enrol.field")} hint={t("enrol.hint")}>
        <TextInput
          id="code"
          name="code"
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={16}
          required
        />
      </Field>
      <ErrorAlert message={message} />
      <Button type="submit" disabled={state === "sending"}>
        {t("enrol.submit")}
      </Button>
      <Muted>{t("enrol.homeScreenNote")}</Muted>
    </form>
  );
}
