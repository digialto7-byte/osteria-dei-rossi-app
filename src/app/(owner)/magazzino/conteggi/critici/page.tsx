"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorAlert, Heading, LedgerList, linkClass, Muted, SuccessNote } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { useMe } from "@/components/use-me";
import { emptyFor } from "@/lib/empty/empty-content";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { CriticalRow } from "./critical-row";

const FORBIDDEN = 403;

interface CriticalList {
  items: { ingredientId: string; name: string; baseUnit: string; isCritical: boolean }[];
  criticalCount: number;
}

/** Which ingredients the daily count covers. Reads and writes /api/counts/critical; the count shown is the server's. */
export default function CriticalPage() {
  const role = useMe().me?.user.role ?? null;
  const [data, setData] = useState<CriticalList | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await apiJson<CriticalList>("/api/counts/critical");
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setError(result.error.message);
      return false;
    }
    setData(result.data);
    return true;
  }, []);

  useEffect(() => {
    // Loading the list when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function change(ingredientId: string, critical: boolean) {
    setBusy(true);
    setSaved(false);
    setError(null);
    const result = await apiJson("/api/counts/critical", {
      method: "PATCH",
      body: { ingredientId, critical },
    });
    if (!result.ok) {
      setBusy(false);
      return setError(result.error.message);
    }
    if (await load()) setSaved(true);
    setBusy(false);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("count.critical.title")}</Heading>
        <ErrorAlert message={t("count.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("count.critical.title")}</Heading>
      <Muted>{t("count.critical.hint")}</Muted>
      {data && (
        <p className="num font-bold">
          {t("count.critical.selected", { count: data.criticalCount })}
        </p>
      )}
      <ErrorAlert message={error} />
      {saved && <SuccessNote role="status">{t("count.critical.saved")}</SuccessNote>}
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : data.items.length === 0 ? (
        <EmptyState {...emptyFor("criticalCounts", role)} />
      ) : (
        <LedgerList>
          {data.items.map((item) => (
            <CriticalRow
              key={item.ingredientId}
              item={item}
              busy={busy}
              onChange={(checked) => void change(item.ingredientId, checked)}
            />
          ))}
        </LedgerList>
      )}
      <Link href="/magazzino/conteggi" className={`${linkClass} self-start`}>
        ← {t("count.back")}
      </Link>
    </>
  );
}
