"use client";

import { useState } from "react";
import { forgetUser } from "@/components/forget-user";
import { Button } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t, tn } from "@/lib/i18n";
import { useSyncView } from "@/pwa/use-outbox";

/**
 * "Esci": ends the session, forgets the cached user and the service worker's read cache (so the next person on a shared device
 * never inherits the role or the prices), and goes to "/" with a full page load (a client-side replace can be answered from the router
 * cache and never reaches the proxy), where the proxy sends a signed-out visitor to /pin on an enrolled device and to /login otherwise.
 * Operations of this person that are not sent yet stay on the phone and go out when they sign in again (M20, Q125 default): the button
 * says so while it logs out. `className` goes on a wrapper, e.g. `lg:hidden` where the sidebar already has "Esci".
 */
export function LogoutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const { mine } = useSyncView();

  async function logout() {
    if (busy) return;
    setBusy(true);
    // Leave even if the request failed: the device must not stay stuck on the previous person's screen.
    await apiJson("/api/auth/logout", { method: "POST", body: {} });
    forgetUser();
    window.location.replace("/");
  }

  return (
    <div className={className}>
      <Button variant="secondary" onClick={logout}>
        {t("home.logout")}
      </Button>
      {busy && mine > 0 && (
        <p role="status" className="mt-2 text-sm text-ink-muted">
          {tn("sync.logout.pending", mine)}
        </p>
      )}
    </div>
  );
}
