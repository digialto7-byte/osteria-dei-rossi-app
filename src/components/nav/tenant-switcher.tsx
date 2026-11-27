"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRequestLeave } from "@/components/nav/leave-guard";
import { useTenants } from "@/components/use-tenants";
import { t, tn } from "@/lib/i18n";
import { switchTenant } from "@/lib/tenancy/switch";
import { switchMessageKey } from "@/lib/tenancy/switch-message";
import { useSyncView } from "@/pwa/use-outbox";

/**
 * The venue switcher (SP2 S10, Q-S5): shown only to a login with two or more venues, as GET /api/me/tenants lists them (never offline-cached;
 * `/api/me` has no `tenantCount`). A button names the current venue and opens a list of the others; a tap asks the page's leave guard, then runs
 * `switchTenant`, which reloads the page. The venue name is shown here and nowhere else, so a single-venue login sees no change.
 * `tone` is the header band's ink or the page's.
 */
export function TenantSwitcher({ tone }: { tone: "band" | "page" }) {
  const state = useTenants();
  const requestLeave = useRequestLeave();
  const { mine } = useSyncView();
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const root = triggerRef.current?.closest("[data-slot='tenant-switcher']");
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (state.status !== "ok" || state.tenants.length < 2) return null;
  const current = state.tenants.find((venue) => venue.current) ?? null;
  const others = state.tenants.filter((venue) => !venue.current);
  const band = tone === "band";
  const ink = band ? "text-band-ink" : "text-ink";
  const ring = band ? "focus-visible:outline-band-ink" : "";
  const edge = band ? "border-band-ink" : "border-ink";

  function choose(id: string) {
    if (busy) return;
    requestLeave(() => {
      setBusy(true);
      setError(null);
      void switchTenant(id, { next: "/" }).then((result) => {
        if (result.ok) return; // the page is reloading
        setError(t(switchMessageKey(result.code)));
        setBusy(false);
      });
    });
  }

  return (
    <div
      data-slot="tenant-switcher"
      className="relative flex min-w-0 flex-col items-end"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${t("tenantSwitch.open")}. ${current ? t("tenantSwitch.current", { name: current.name }) : ""}`.trim()}
        aria-disabled={busy ? true : undefined}
        onClick={() => !busy && setOpen((v) => !v)}
        className={`inline-flex min-h-tap min-w-tap max-w-full items-center justify-center rounded-lg border-[1.5px] ${edge} px-3 text-base font-bold ${ink} ${ring} aria-disabled:opacity-60`}
      >
        <span className="truncate">{current ? current.name : t("tenantSwitch.open")}</span>
      </button>
      {open && (
        <ul
          id={listId}
          className="mt-1 flex w-full min-w-48 flex-col gap-1 rounded-lg border-[1.5px] border-ink bg-surface p-1 text-ink lg:absolute lg:top-full lg:z-40"
        >
          {others.map((venue) => (
            <li key={venue.id}>
              <button
                type="button"
                aria-disabled={busy ? true : undefined}
                onClick={() => choose(venue.id)}
                className="aria-disabled:opacity-60 flex min-h-tap w-full flex-col items-start justify-center rounded-md px-3 py-2 text-left hover:bg-sunk"
              >
                <span className="font-bold [overflow-wrap:anywhere]">{venue.name}</span>
                <span className="text-sm text-ink-muted">{t(`role.${venue.role}`)}</span>
              </button>
            </li>
          ))}
          {mine > 0 && !busy && (
            <li className="px-3 py-2 text-sm text-ink-muted">{tn("tenantSwitch.pending", mine)}</li>
          )}
        </ul>
      )}
      {busy && (
        <p role="status" className={`mt-1 basis-full text-right text-sm ${ink}`}>
          {t("tenantSwitch.busy")}
          {mine > 0 ? ` ${tn("tenantSwitch.pending", mine)}` : ""}
        </p>
      )}
      {error && (
        <p role="alert" className={`mt-1 text-right text-sm ${ink}`}>
          {error}
        </p>
      )}
    </div>
  );
}
