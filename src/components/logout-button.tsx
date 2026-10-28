"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { resetMe } from "@/components/use-me";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";

/**
 * "Esci": ends the session, forgets the cached user (so the next person on a shared device never inherits
 * the role) and goes to "/", where the proxy sends a signed-out visitor to /pin on an enrolled device and to
 * /login otherwise. `className` goes on a wrapper, e.g. `lg:hidden` where the sidebar already has "Esci".
 */
export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    // Leave even if the request failed: the device must not stay stuck on the previous person's screen.
    await apiJson("/api/auth/logout", { method: "POST", body: {} });
    resetMe();
    router.replace("/");
  }

  return (
    <div className={className}>
      <Button variant="secondary" onClick={logout}>
        {t("home.logout")}
      </Button>
    </div>
  );
}
