"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorAlert, Heading, LedgerList, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { BatchRow, type BatchRowItem } from "./batch-row";

const FORBIDDEN = 403;

interface BatchPage {
  items: BatchRowItem[];
  nextCursor: string | null;
}

/**
 * The batches made, newest first. Reads /api/batches only: the use-by state, the portions left and (for owner and
 * admin) the frozen cost come with each batch. One primary button starts a production.
 */
export default function ProductionPage() {
  const router = useRouter();
  const [data, setData] = useState<BatchPage | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(async () => {
    const isNewest = startRequest();
    const result = await apiJson<BatchPage>("/api/batches");
    if (!isNewest()) return;
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setError(result.error.message);
      return;
    }
    setError(null);
    setData(result.data);
  }, [startRequest]);

  useEffect(() => {
    // Loading the list when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function showMore() {
    if (!data?.nextCursor) return;
    setBusy(true);
    const result = await apiJson<BatchPage>(
      `/api/batches?before=${encodeURIComponent(data.nextCursor)}`,
    );
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setData({ items: [...data.items, ...result.data.items], nextCursor: result.data.nextCursor });
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("production.title")}</Heading>
        <ErrorAlert message={t("production.forbidden")} />
      </>
    );
  }
  return (
    <>
      <Heading>{t("production.title")}</Heading>
      <div>
        <Button onClick={() => router.push("/produzione/nuova")}>{t("production.new")}</Button>
      </div>
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : data.items.length === 0 ? (
        <Muted>{t("production.empty")}</Muted>
      ) : (
        <LedgerList>
          {data.items.map((item) => (
            <BatchRow key={item.batchId} item={item} />
          ))}
        </LedgerList>
      )}
      {data?.nextCursor && (
        <div>
          <Button variant="secondary" disabled={busy} onClick={showMore}>
            {t("production.more")}
          </Button>
        </div>
      )}
    </>
  );
}
