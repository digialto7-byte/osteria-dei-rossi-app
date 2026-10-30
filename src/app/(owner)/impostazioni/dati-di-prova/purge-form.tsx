"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorAlert, Field, Muted, SuccessNote, TextInput } from "@/components/ui";
import { forgetUser } from "@/components/forget-user";
import { apiJson } from "@/lib/api/client";
import { confirmMatches } from "@/lib/demo/demo-view";
import { t } from "@/lib/i18n";

/**
 * Deleting the demo data: the owner types the venue name, the button unlocks on an exact match, and the server checks
 * the name again. On success the session ends and the page goes to /login (the owner signs in again; the tenant and the owner stay).
 */
export function PurgeForm({ tenantName }: { tenantName: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function purge() {
    setBusy(true);
    setError(null);
    const result = await apiJson("/api/demo/purge", {
      method: "POST",
      body: { confirmName: typed },
    });
    if (!result.ok) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    setDone(true);
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
    // The session is over: the cached user must not outlive it on a shared device.
    forgetUser();
    router.replace("/login");
  }

  if (done) return <SuccessNote role="status">{t("demo.purge.done")}</SuccessNote>;

  return (
    <Card role="group" aria-label={t("demo.purge.title")} className="flex flex-col gap-3">
      <Muted>{t("demo.purge.intro")}</Muted>
      <p>
        {t("demo.purge.nameIs")} <strong className="[overflow-wrap:anywhere]">{tenantName}</strong>
      </p>
      <Field label={t("demo.purge.confirmLabel")}>
        <TextInput
          name="confirmName"
          value={typed}
          disabled={busy}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>
      <ErrorAlert message={error} />
      <Button
        variant="danger"
        onClick={() => void purge()}
        disabled={busy || !confirmMatches(typed, tenantName)}
        className="self-start"
      >
        {t("demo.purge.submit")}
      </Button>
    </Card>
  );
}
