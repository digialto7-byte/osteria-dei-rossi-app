"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

  if (state.kind === "loading") return <p>{t("home.loading")}</p>;
  if (state.kind === "signedOut") {
    return (
      <p>
        {t("home.signedOut")}{" "}
        <a href="/login" className="inline-flex min-h-tap items-center underline">
          {t("login.title")}
        </a>
      </p>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
      {state.kind === "ok" ? (
        <section aria-label={state.me.tenant.name} className="flex flex-col gap-1">
          <p className="text-lg">{t("home.greeting", { name: state.me.user.displayName })}</p>
          <p>{state.me.tenant.name}</p>
          <p data-testid="role">{t("home.role", { role: t(`role.${state.me.user.role}`) })}</p>
        </section>
      ) : (
        <p role="alert">{t("home.noAccess")}</p>
      )}
      <button
        type="button"
        onClick={logout}
        className="min-h-tap self-start rounded border border-stone-400 px-4 font-medium"
      >
        {t("home.logout")}
      </button>
    </>
  );
}
