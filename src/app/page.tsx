"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, ErrorAlert, Heading, Muted, linkClass } from "@/components/ui";
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
    fetch("/api/me")
      .then(async (response) => {
        if (response.ok) return setState({ kind: "ok", me: (await response.json()) as Me });
        setState({ kind: response.status === 403 ? "noAccess" : "signedOut" });
      })
      .catch(() => setState({ kind: "signedOut" }));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    router.replace("/login");
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
              <p className="font-display text-[1.625rem] leading-tight">{state.me.tenant.name}</p>
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
