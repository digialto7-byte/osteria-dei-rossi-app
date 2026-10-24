"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, ErrorAlert, Heading, Muted, linkClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { canReadAlerts } from "@/lib/alerts/alert-view";
import { canReadAudit } from "@/lib/counts/count-view";
import { canReadPayables } from "@/lib/payables/payable-view";
import { canProduce } from "@/lib/batches/batch-view";
import { canReadStock } from "@/lib/stock/stock-view";
import { canReadRules } from "@/lib/rules/rules-view";
import { t } from "@/lib/i18n";

interface Me {
  user: { id: string; displayName: string; role: "owner" | "admin" | "chef" | "waiter" };
  tenant: { id: string; name: string };
}

type State =
  { kind: "loading" } | { kind: "ok"; me: Me } | { kind: "noAccess" } | { kind: "signedOut" };

export default function HomePage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    // apiJson sends a staff session that has ended back to the PIN screen.
    apiJson<Me>("/api/me").then((result) => {
      if (result.ok) return setState({ kind: "ok", me: result.data });
      setState({ kind: result.status === 403 ? "noAccess" : "signedOut" });
    });
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    // The proxy sends a signed-out visitor to /pin on an enrolled device and to /login otherwise.
    router.replace("/");
  }

  if (state.kind === "loading") return <Muted>{t("home.loading")}</Muted>;
  if (state.kind === "signedOut") {
    return (
      <p>
        {t("home.signedOut")}{" "}
        <a href="/login" className={linkClass}>
          {t("login.title")}
        </a>
      </p>
    );
  }

  return (
    <>
      <Heading>
        {state.kind === "ok"
          ? t("home.greeting", { name: state.me.user.displayName })
          : t("app.name")}
      </Heading>
      {state.kind === "ok" ? (
        <section aria-label={state.me.tenant.name}>
          <Card className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5 border-b border-rule pb-3">
              <p className="font-display text-[1.5rem] leading-tight font-semibold">
                {state.me.tenant.name}
              </p>
              <p data-testid="role" className="text-ink-muted">
                {t("home.role", { role: t(`role.${state.me.user.role}`) })}
              </p>
            </div>
            {state.me.user.role !== "waiter" && (
              <Link href="/anagrafiche/fornitori" className={`${linkClass} self-start`}>
                {t("home.masterData")}
                <span aria-hidden="true" className="inline-block">
                  →
                </span>
              </Link>
            )}
            {canReadPayables(state.me.user.role) && (
              <Link href="/pagamenti" className={`${linkClass} self-start`}>
                {t("home.payables")}
                <span aria-hidden="true" className="inline-block">
                  →
                </span>
              </Link>
            )}
            {canReadStock(state.me.user.role) && (
              <Link href="/magazzino" className={`${linkClass} self-start`}>
                {t("home.stock")}
                <span aria-hidden="true" className="inline-block">
                  →
                </span>
              </Link>
            )}
            {canProduce(state.me.user.role) && (
              <Link href="/produzione" className={`${linkClass} self-start`}>
                {t("home.production")}
                <span aria-hidden="true" className="inline-block">
                  →
                </span>
              </Link>
            )}
            {canReadRules(state.me.user.role) && (
              <Link href="/riordino" className={`${linkClass} self-start`}>
                {t("home.reorder")}
                <span aria-hidden="true" className="inline-block">
                  →
                </span>
              </Link>
            )}
            {canReadAudit(state.me.user.role) && (
              <Link href="/registro" className={`${linkClass} self-start`}>
                {t("home.audit")}
                <span aria-hidden="true" className="inline-block">
                  →
                </span>
              </Link>
            )}
            {canReadAlerts(state.me.user.role) && (
              <Link href="/avvisi" className={`${linkClass} self-start`}>
                {t("home.alerts")}
                <span aria-hidden="true" className="inline-block">
                  →
                </span>
              </Link>
            )}
          </Card>
        </section>
      ) : (
        <ErrorAlert message={t("home.noAccess")} />
      )}
      <div>
        <Button variant="secondary" onClick={logout}>
          {t("home.logout")}
        </Button>
      </div>
    </>
  );
}
