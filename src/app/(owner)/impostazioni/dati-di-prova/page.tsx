"use client";

import { useEffect, useState } from "react";
import { ErrorAlert, Heading, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { canPurge } from "@/lib/demo/demo-view";
import { t } from "@/lib/i18n";
import { PurgeForm } from "./purge-form";

interface Me {
  user: { role: string };
  tenant: { name: string; isDemo: boolean };
}

type State = { kind: "loading" } | { kind: "ok"; me: Me } | { kind: "error"; message: string };

/** The page behind the demo banner. Reads /api/me; a real tenant or a non-owner sees only the "no demo data" text. */
export default function DemoDataPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    void apiJson<Me>("/api/me").then((result) =>
      setState(
        result.ok
          ? { kind: "ok", me: result.data }
          : { kind: "error", message: result.error.message },
      ),
    );
  }, []);

  return (
    <>
      <Heading>{t("demo.purge.title")}</Heading>
      {state.kind === "loading" && <Muted>{t("common.loading")}</Muted>}
      {state.kind === "error" && <ErrorAlert message={state.message} />}
      {state.kind === "ok" &&
        (canPurge(state.me.user.role, state.me.tenant.isDemo) ? (
          <PurgeForm tenantName={state.me.tenant.name} />
        ) : (
          <Muted>{t("demo.purge.none")}</Muted>
        ))}
    </>
  );
}
