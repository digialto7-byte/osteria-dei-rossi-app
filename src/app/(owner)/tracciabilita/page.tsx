"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorAlert, Heading } from "@/components/ui";
import { SegmentedControl } from "@/components/segmented-control";
import { useOnline } from "@/components/use-online";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { LotCapture } from "@/server/trace/output";
import { CaptureCard } from "./capture-card";
import { LineSearch } from "./line-search";
import { LotSearch } from "./lot-search";

const FORBIDDEN = 403;
type Tab = "lotto" | "piatto";

/**
 * Tracciabilità (P2-2 spec §3): a recall letter or a complaint starts here. Two tabs, "Da un lotto" and "Da un piatto servito"; the tab and the
 * search live in the address (`?da=piatto`, `?lotto=…`), so Back and a shared link reopen them. Owner, admin and chef; the API says no to anyone
 * else and the page then shows the sentence and no form. Not offline: the form is disabled and says why.
 */
export default function TracePage() {
  const online = useOnline();
  const [tab, setTab] = useState<Tab | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [capture, setCapture] = useState<LotCapture | null>(null);
  const onForbidden = useCallback(() => setForbidden(true), []);

  useEffect(() => {
    // Opening on the tab the address names, and reading the capture rate, is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(new URLSearchParams(window.location.search).get("da") === "piatto" ? "piatto" : "lotto");
    void apiJson<LotCapture>("/api/trace/capture").then((reply) => {
      if (reply.ok) setCapture(reply.data);
      else if (reply.status === FORBIDDEN) setForbidden(true);
    });
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
    if (next === "piatto") url.searchParams.set("da", "piatto");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("trace.title")}</Heading>
        <ErrorAlert message={t("trace.forbidden")} />
      </>
    );
  }
  return (
    <>
      <Heading>{t("trace.title")}</Heading>
      {tab !== null && (
        <SegmentedControl
          label={t("trace.tabs.label")}
          segments={[
            { key: "lotto", label: t("trace.tab.lot") },
            { key: "piatto", label: t("trace.tab.plate") },
          ]}
          selected={tab}
          onSelect={choose}
        />
      )}
      {tab === "lotto" ? <LotSearch online={online} onForbidden={onForbidden} /> : null}
      {tab === "piatto" ? <LineSearch online={online} onForbidden={onForbidden} /> : null}
      {tab === "lotto" && capture ? <CaptureCard capture={capture} /> : null}
    </>
  );
}
