"use client";

import { useLogout } from "@/components/logout-button";
import { t, tn } from "@/lib/i18n";

/**
 * The signed-in person's own name and "Esci" in the header band, on every signed-in screen of a phone (QW6, ADR-041): a shared
 * kitchen phone shows who is signed in, and "Esci" is one tap away on `/cucina` and on the comanda too. The laptop sidebar keeps its
 * own (`lg:hidden` here). The name is passed in by the shell once /api/me has answered, so the server-rendered shell holds none.
 * The logout is the one `LogoutButton` uses; the pending-operations line is in the band ink.
 */
export function AccountControl({ name }: { name: string }) {
  const { busy, mine, logout } = useLogout();
  return (
    <div
      data-slot="account-control"
      className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 lg:hidden"
    >
      <span className="min-w-0 truncate text-sm text-band-ink">{name}</span>
      <button
        type="button"
        onClick={logout}
        className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg border-[1.5px] border-band-ink px-3 text-base font-bold text-band-ink focus-visible:outline-band-ink"
      >
        {t("home.logout")}
      </button>
      {busy && mine > 0 && (
        <p role="status" className="basis-full text-right text-sm text-band-ink">
          {tn("sync.logout.pending", mine)}
        </p>
      )}
    </div>
  );
}
