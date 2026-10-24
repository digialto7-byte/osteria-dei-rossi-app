"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import {
  ErrorAlert,
  Heading,
  LedgerList,
  Muted,
  SubHeading,
  SuccessNote,
  linkClass,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { formatPortions } from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import type { AdjustResult, BatchDetail, DiscardResult, SplitResult } from "@/server/batches/types";
import type { BatchWasteReason } from "@/server/batches/reasons";
import { ActionPanel } from "./action-panel";
import { BatchFacts } from "./batch-facts";
import { MovementRow } from "./movement-row";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

interface Place {
  id: string;
  name: string;
  isActive?: boolean;
}

/**
 * One batch: its facts, the three actions (count, discard, split) and the history. Reads /api/batches/:id and
 * /api/locations; the actions POST to /api/batches/:id/{adjust,discard,split} and the page reads the batch again.
 * Everything shown (what can be done, the hours left, the state) is the API's; nothing is worked out here.
 */
export default function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(async () => {
    const isNewest = startRequest();
    const result = await apiJson<BatchDetail>(`/api/batches/${id}`);
    if (!isNewest()) return;
    if (result.ok) return setDetail(result.data);
    if (result.status === FORBIDDEN) return setMessage(t("production.forbidden"));
    if (result.status === NOT_FOUND) return setMessage(t("production.label.notFound"));
    setMessage(result.error.message);
  }, [id, startRequest]);

  useEffect(() => {
    // Loading the batch when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void (async () => {
      const result = await apiJson<{ locations: Place[] }>("/api/locations");
      if (result.ok) setPlaces(result.data.locations.filter((place) => place.isActive !== false));
    })();
  }, [load]);

  /** Sends one action; true when it was recorded. */
  async function act<T>(
    action: string,
    body: object,
    done: (data: T) => string | null,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await apiJson<T>(`/api/batches/${id}/${action}`, { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    setNote(done(result.data));
    await load();
    return true;
  }

  const adjust = (counted: number) =>
    act<AdjustResult>("adjust", { counted }, (r) =>
      r.delta === 0
        ? t("batch.adjust.doneSame")
        : t("batch.adjust.done", { delta: formatPortions(r.delta, "it", true) }),
    );
  const discard = (portions: number, reason: BatchWasteReason) =>
    act<DiscardResult>("discard", { portions, reason }, (r) =>
      t("batch.discard.done", { delta: formatPortions(-r.portions, "it", true) }),
    );
  const split = async (portions: number, hoursFromNow: number, locationId?: string) => {
    const ok = await act<SplitResult>(
      "split",
      { portions, hoursFromNow, ...(locationId ? { locationId } : {}) },
      (r) => {
        router.push(`/produzione/${r.newBatchId}/etichetta?diviso=1`);
        return null;
      },
    );
    return ok;
  };

  if (!detail) {
    return (
      <>
        <ErrorAlert message={message} />
        {!message && <Muted>{t("common.loading")}</Muted>}
        <BackLink />
      </>
    );
  }
  return (
    <>
      <Heading>{detail.recipeName}</Heading>
      {note && <SuccessNote role="status">{note}</SuccessNote>}
      <BatchFacts detail={detail} />
      <ActionPanel
        can={detail.can}
        remaining={detail.portionsRemaining}
        hoursLeft={detail.defaults.hoursLeft}
        locations={places}
        locationId={detail.locationId}
        busy={busy}
        error={error}
        onAdjust={adjust}
        onDiscard={discard}
        onSplit={split}
      />
      <Link href={`/produzione/${detail.batchId}/etichetta`} className={`${linkClass} self-start`}>
        {t("batch.detail.reprint")}
      </Link>
      <SubHeading>{t("batch.detail.history")}</SubHeading>
      <LedgerList>
        {detail.movements.map((movement) => (
          <MovementRow key={movement.id} movement={movement} />
        ))}
      </LedgerList>
      <BackLink />
    </>
  );
}

function BackLink() {
  return (
    <Link href="/produzione" className={`${linkClass} self-start`}>
      ← {t("production.back")}
    </Link>
  );
}
