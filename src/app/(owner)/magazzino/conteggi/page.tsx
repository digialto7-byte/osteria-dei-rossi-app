"use client";

import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, ErrorAlert, Heading, LedgerList, linkClass, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { CountSession, CountSessionDetail, CountType } from "@/server/counts/types";
import { CountSessionRow } from "./count-session-row";
import { StartCount } from "./start-count";

const FORBIDDEN = 403;

interface SessionList {
  sessions: CountSession[];
  nextCursor: string | null;
}

/** The count list. Reads /api/counts, /api/counts/critical and /api/locations; every rule and counter is the server's. */
export default function CountsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<CountSession[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [criticalCount, setCriticalCount] = useState<number | null>(null);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (before: string | null) => {
    const query = before ? `?before=${encodeURIComponent(before)}` : "";
    const result = await apiJson<SessionList>(`/api/counts${query}`);
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setError(result.error.message);
      return;
    }
    setError(null);
    setSessions((current) =>
      before && current ? [...current, ...result.data.sessions] : result.data.sessions,
    );
    setNextCursor(result.data.nextCursor);
  }, []);

  useEffect(() => {
    // Loading the list when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
    void (async () => {
      const critical = await apiJson<{ criticalCount: number }>("/api/counts/critical");
      if (critical.ok) setCriticalCount(critical.data.criticalCount);
      const places = await apiJson<{ locations: { id: string; name: string }[] }>("/api/locations");
      if (places.ok) setLocations(places.data.locations);
    })();
  }, [load]);

  async function start(type: CountType, locationId: string | null) {
    setBusy(true);
    setStartError(null);
    const result = await apiJson<CountSessionDetail>("/api/counts", {
      method: "POST",
      body: { type, ...(locationId ? { locationId } : {}) },
    });
    setBusy(false);
    if (!result.ok) return setStartError(result.error.message);
    router.push(`/magazzino/conteggi/${result.data.id}`);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("count.title")}</Heading>
        <ErrorAlert message={t("count.forbidden")} />
      </>
    );
  }

  const open = sessions?.find((session) => session.status === "open") ?? null;
  return (
    <>
      <BackLink href="/magazzino">{t("stock.costs.back")}</BackLink>
      <Heading>{t("count.title")}</Heading>
      <StartCount
        openSession={open}
        locations={locations}
        busy={busy}
        error={startError}
        onStart={start}
      />
      {criticalCount !== null && (
        <Link href="/magazzino/conteggi/critici" className={`${linkClass} self-start`}>
          {t("count.criticalLink", { count: criticalCount })}
        </Link>
      )}
      <ErrorAlert message={error} />
      {sessions === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : sessions.length === 0 ? (
        <Muted>{t("count.empty")}</Muted>
      ) : (
        <LedgerList>
          {sessions.map((session) => (
            <CountSessionRow key={session.id} session={session} />
          ))}
        </LedgerList>
      )}
      {nextCursor && (
        <div>
          <Button variant="secondary" onClick={() => void load(nextCursor)}>
            {t("count.more")}
          </Button>
        </div>
      )}
    </>
  );
}
