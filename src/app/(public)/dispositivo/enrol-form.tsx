"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { Button, ErrorAlert, Field, Heading, Muted, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { enrolFeedback } from "@/lib/staff-auth/enrol-view";

type State = "idle" | "sending";

/**
 * Enrols this browser as a venue device with the owner's code (POST /api/devices/enrol). On success the phone goes
 * straight to the staff screen ("Chi sei?"); the old extra tap is gone (M25a).
 */
export function EnrolForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [state, setState] = useState<State>("idle");
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
      router.replace("/login?abilitato=1");
      return;
    }
    setMessage(enrolFeedback(result.error));
    setState("idle");
  }

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4">
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
      <Button type="submit" disabled={state === "sending" || !hydrated}>
        {t("enrol.submit")}
      </Button>
      <Muted>{t("enrol.homeScreenNote")}</Muted>
    </form>
  );
}
