"use client";

import { useId, useState } from "react";
import { useConsoleShell } from "@/components/console/console-shell";
import { RawCode } from "@/components/console/raw-code";
import { ReadError } from "@/components/read-error";
import { useConsoleRead } from "@/components/console/use-console-read";
import { SegmentedControl } from "@/components/segmented-control";
import { Button, ErrorAlert, Heading, LedgerList, LedgerRow, Muted } from "@/components/ui";
import { consoleApi, resetConsoleSwitch } from "@/lib/console/console-api";
import { formatInstant } from "@/lib/console/console-dates";
import { failureMessage } from "@/lib/console/failure-message";
import { noticeSentence, notifiedLine, splitNotices } from "@/lib/console/notice-view";
import { t } from "@/lib/i18n";
import type { Notice } from "@/lib/platform/api";

type Tab = "unread" | "read";

/** What the person did to one venue of one notice in this screen: working, answered (with the reply's date), or failed. */
type Mark =
  { state: "busy" } | { state: "done"; notifiedAt: string } | { state: "failed"; message: string };

const markKey = (noticeId: string, tenantId: string) => `${noticeId}:${tenantId}`;
const LIST = "flex flex-col gap-2";

function PendingRow({
  name,
  mark,
  onMark,
}: {
  name: string;
  mark: Mark | undefined;
  onMark: () => void;
}) {
  const nameId = useId();
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span id={nameId} className="[overflow-wrap:anywhere]">
          {name}
        </span>
        {mark?.state === "done" ? (
          <Muted>{notifiedLine(mark.notifiedAt)}</Muted>
        ) : (
          <Button
            variant="secondary"
            aria-describedby={nameId}
            disabled={mark?.state === "busy"}
            onClick={onMark}
          >
            {t("console.notices.mark")}
          </Button>
        )}
      </div>
      {mark?.state === "failed" && <ErrorAlert message={mark.message} />}
    </li>
  );
}

function NoticeItem({
  notice,
  marks,
  onMark,
}: {
  notice: Notice;
  marks: Record<string, Mark>;
  onMark: (notice: Notice, tenantId: string) => void;
}) {
  return (
    <LedgerRow className="flex flex-col gap-2 py-4">
      <p className="font-bold text-ink [overflow-wrap:anywhere]">
        {noticeSentence(notice) ?? notice.kind}
      </p>
      <RawCode code={notice.kind} />
      <Muted>{t("console.createdOn", { date: formatInstant(notice.createdAt) })}</Muted>
      {notice.pending.length > 0 && (
        <ul className={LIST}>
          {notice.pending.map((venue) => (
            <PendingRow
              key={venue.id}
              name={venue.name}
              mark={marks[markKey(notice.id, venue.id)]}
              onMark={() => onMark(notice, venue.id)}
            />
          ))}
        </ul>
      )}
      {notice.notified.length > 0 && (
        <ul className={LIST}>
          {notice.notified.map((venue) => (
            <li
              key={venue.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
            >
              <span className="[overflow-wrap:anywhere]">{venue.name}</span>
              <Muted>{notifiedLine(venue.notifiedAt)}</Muted>
            </li>
          ))}
        </ul>
      )}
    </LedgerRow>
  );
}

/**
 * Avvisi: the platform notices, «Da leggere» (someone is still pending) and «Letti». «Segna come avvisato» records the venue as notified; the row
 * then shows the reply's date and the Avvisato count is read again. A notice moves to «Letti» on the next read, never under the person's thumb.
 */
export function AvvisiScreen() {
  const { load, reload, busy } = useConsoleRead<{ notices: Notice[] }>("/api/platform/notices");
  const { refreshMe } = useConsoleShell();
  const [tab, setTab] = useState<Tab>("unread");
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const tabsId = useId();

  async function mark(notice: Notice, tenantId: string) {
    const key = markKey(notice.id, tenantId);
    // A second try after a failure is the person's own action: it may start a new switch into console mode.
    if (marks[key]?.state === "failed") resetConsoleSwitch();
    setMarks((all) => ({ ...all, [key]: { state: "busy" } }));
    const result = await consoleApi<{ notifiedAt: string; changed: boolean }>(
      `/api/platform/notices/${encodeURIComponent(notice.id)}/notified`,
      { method: "POST", body: { tenantId } },
    );
    if (result.ok) {
      setMarks((all) => ({
        ...all,
        [key]: { state: "done", notifiedAt: result.data.notifiedAt },
      }));
      refreshMe();
    } else if (!result.leaving) {
      setMarks((all) => ({
        ...all,
        [key]: { state: "failed", message: failureMessage(result, "console.notices.markError") },
      }));
    }
  }

  const { unread, read } = splitNotices(load.kind === "ready" ? load.data.notices : []);
  const shown = tab === "unread" ? unread : read;
  const tabId = (key: Tab) => `${tabsId}-${key}`;

  return (
    <>
      <Heading>{t("console.notices.title")}</Heading>
      <SegmentedControl
        label={t("console.notices.title")}
        selected={tab}
        onSelect={setTab}
        segments={[
          {
            key: "unread",
            label: t("console.notices.tab.unread"),
            id: tabId("unread"),
            controls: `${tabsId}-panel`,
          },
          {
            key: "read",
            label: t("console.notices.tab.read"),
            id: tabId("read"),
            controls: `${tabsId}-panel`,
          },
        ]}
      />
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={tabId(tab)}>
        {load.kind === "loading" && <Muted>{t("common.loading")}</Muted>}
        {load.kind === "error" && (
          <ReadError
            message={failureMessage(load.failure, "console.notices.readError")}
            onRetry={reload}
            busy={busy}
          />
        )}
        {load.kind === "ready" &&
          (shown.length === 0 ? (
            <Muted>
              {t(tab === "unread" ? "console.notices.emptyUnread" : "console.notices.emptyRead")}
            </Muted>
          ) : (
            <LedgerList>
              {shown.map((notice) => (
                <NoticeItem
                  key={notice.id}
                  notice={notice}
                  marks={marks}
                  onMark={(n, tenantId) => void mark(n, tenantId)}
                />
              ))}
            </LedgerList>
          ))}
      </div>
    </>
  );
}
