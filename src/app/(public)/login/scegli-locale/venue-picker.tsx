"use client";

import { useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { Button, ErrorAlert, linkClass, Muted } from "@/components/ui";
import { useTenants } from "@/components/use-tenants";
import { t } from "@/lib/i18n";
import { switchTenant } from "@/lib/tenancy/switch";
import { switchMessageKey } from "@/lib/tenancy/switch-message";

/**
 * The list of venues of the login, one full-width button each (name, role, the current one marked). A tap runs `switchTenant`, which reloads
 * the page on success; this component only shows what it returned. No data logic here: the list is GET /api/me/tenants.
 */
export function VenuePicker({ next }: { next: string | undefined }) {
  const state = useTenants();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    const result = await switchTenant(id, { next });
    // On success the page is reloading; stay busy until it does.
    if (!result.ok) {
      setError(t(switchMessageKey(result.code)));
      setBusyId(null);
    }
  }

  if (state.status === "loading") return <Muted>{t("common.loading")}</Muted>;
  if (state.status === "signedOut") {
    return (
      <p>
        {t("home.signedOut")}{" "}
        <a href="/login" className={linkClass}>
          {t("login.title")}
        </a>
      </p>
    );
  }
  if (state.status === "offline" || state.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <ErrorAlert message={t(state.status === "offline" ? "tenantSwitch.offline" : "me.error")} />
        <div>
          <Button variant="secondary" onClick={state.retry}>
            {t("common.retry")}
          </Button>
        </div>
        <LogoutButton />
      </div>
    );
  }
  if (state.tenants.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorAlert message={t("home.noAccess")} />
        <LogoutButton />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {state.tenants.map((venue) => (
          <li key={venue.id}>
            <button
              type="button"
              aria-current={venue.current ? "true" : undefined}
              aria-disabled={busyId !== null ? true : undefined}
              onClick={() => void choose(venue.id)}
              className={
                "flex min-h-tap w-full flex-col items-start justify-center rounded-lg border-[1.5px] border-ink px-4 py-3 text-left aria-disabled:cursor-not-allowed aria-disabled:opacity-60 " +
                (venue.current ? "bg-ink text-paper" : "bg-surface text-ink hover:bg-sunk")
              }
            >
              <span className="font-bold [overflow-wrap:anywhere]">{venue.name}</span>
              <span className="text-sm">
                {t(`role.${venue.role}`)}
                {venue.current ? ` · ${t("tenantSwitch.currentTag")}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {busyId !== null && <p role="status">{t("tenantSwitch.busy")}</p>}
      <ErrorAlert message={error} />
      <LogoutButton />
    </div>
  );
}
