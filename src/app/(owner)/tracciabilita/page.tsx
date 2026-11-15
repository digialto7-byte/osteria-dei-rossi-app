"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
const TABS: Tab[] = ["lotto", "piatto"];
const tabId = (tab: Tab) => `trace-tab-${tab}`;
const panelId = (tab: Tab) => `trace-panel-${tab}`;

/**
 * Tracciabilità (P2-2 spec §3): a recall letter or a complaint starts here. Two tabs, "Da un lotto" and "Da un piatto servito"; the tab and the
 * search live in the address (`?da=piatto`, `?lotto=…`), so Back and a shared link reopen them. Owner, admin and chef; the API says no to anyone
 * else and the page then shows the sentence and no form. Not offline: the form is disabled and says why.
 *
 * Both tabs keep their panel once shown (hidden, not unmounted), so the filters and the result of one survive a look at the other. A panel is
 * mounted on its first activation only: the page makes no request for a tab nobody opened. The address names the visible tab's search; each
 * tab's own search is put back when it returns.
 */
export default function TracePage() {
  const online = useOnline();
  const [tab, setTab] = useState<Tab | null>(null);
  const [shown, setShown] = useState<Record<Tab, boolean>>({ lotto: false, piatto: false });
  // The address (query string) each tab had when it was left, put back when it returns.
  const left = useRef<Partial<Record<Tab, string>>>({});
  const [forbidden, setForbidden] = useState(false);
  const [capture, setCapture] = useState<LotCapture | null>(null);
  const onForbidden = useCallback(() => setForbidden(true), []);

  useEffect(() => {
    // Opening on the tab the address names, and reading the capture rate, is the effect's job here.
    const first: Tab =
      new URLSearchParams(window.location.search).get("da") === "piatto" ? "piatto" : "lotto";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(first);
    setShown((was) => ({ ...was, [first]: true }));
    void apiJson<LotCapture>("/api/trace/capture").then((reply) => {
      if (reply.ok) setCapture(reply.data);
      else if (reply.status === FORBIDDEN) setForbidden(true);
    });
  }, []);

  function choose(next: Tab) {
    if (tab !== null && next !== tab) left.current[tab] = window.location.search;
    setTab(next);
    setShown((was) => ({ ...was, [next]: true }));
    const url = new URL(window.location.href);
    for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
    const back = left.current[next];
    if (back !== undefined) url.search = back;
    else if (next === "piatto") url.searchParams.set("da", "piatto");
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
          segments={TABS.map((key) => ({
            key,
            label: t(key === "lotto" ? "trace.tab.lot" : "trace.tab.plate"),
            id: tabId(key),
            controls: shown[key] ? panelId(key) : undefined,
          }))}
          selected={tab}
          onSelect={choose}
        />
      )}
      {/* The panel carries `hidden` and no display class (a class would beat the attribute); the inner div keeps the page's gap. */}
      {shown.lotto && (
        <div
          role="tabpanel"
          id={panelId("lotto")}
          aria-labelledby={tabId("lotto")}
          hidden={tab !== "lotto"}
        >
          <div className="flex flex-col gap-6">
            <LotSearch online={online} onForbidden={onForbidden} />
          </div>
        </div>
      )}
      {shown.piatto && (
        <div
          role="tabpanel"
          id={panelId("piatto")}
          aria-labelledby={tabId("piatto")}
          hidden={tab !== "piatto"}
        >
          <div className="flex flex-col gap-6">
            <LineSearch online={online} onForbidden={onForbidden} />
          </div>
        </div>
      )}
      {tab === "lotto" && capture ? <CaptureCard capture={capture} /> : null}
    </>
  );
}
