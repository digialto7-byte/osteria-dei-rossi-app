"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorAlert, Field, Heading, LedgerList, Muted, TextInput } from "@/components/ui";
import { TextFilter } from "@/components/text-filter";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import type { AuditEntry, AuditLog } from "@/server/audit/types";
import { AuditRow } from "./audit-row";

const FORBIDDEN = 403;
type Kind = "all" | "stock" | "events";

/** Who changed what and when, for owner and admin. Reads /api/audit; the default period (the Rome month so far) is the server's. */
export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(
    async (range: { from: string; to: string } | null, which: Kind, before: string | null) => {
      const isNewest = startRequest();
      const query = new URLSearchParams();
      if (range) {
        query.set("from", range.from);
        query.set("to", range.to);
      }
      query.set("kind", which);
      if (before) query.set("before", before);
      const result = await apiJson<AuditLog>(`/api/audit?${query.toString()}`);
      if (!isNewest()) return;
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setError(null);
      setEntries((current) =>
        before && current ? [...current, ...result.data.entries] : result.data.entries,
      );
      setNextCursor(result.data.nextCursor);
      setFrom(result.data.from);
      setTo(result.data.to);
    },
    [startRequest],
  );

  useEffect(() => {
    // Loading the log when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null, "all", null);
  }, [load]);

  function change(next: { from: string; to: string }, which = kind) {
    setFrom(next.from);
    setTo(next.to);
    if (next.from && next.to) void load(next, which, null);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("audit.title")}</Heading>
        <ErrorAlert message={t("audit.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("audit.title")}</Heading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("audit.from")}>
          <TextInput
            type="date"
            name="from"
            value={from}
            max={to || undefined}
            onChange={(event) => change({ from: event.target.value, to })}
          />
        </Field>
        <Field label={t("audit.to")}>
          <TextInput
            type="date"
            name="to"
            value={to}
            min={from || undefined}
            onChange={(event) => change({ from, to: event.target.value })}
          />
        </Field>
      </div>
      <TextFilter
        label={t("audit.filters")}
        value={kind}
        onChange={(next) => {
          setKind(next);
          change({ from, to }, next);
        }}
        options={[
          { value: "all", label: t("audit.filter.all") },
          { value: "stock", label: t("audit.filter.stock") },
          { value: "events", label: t("audit.filter.events") },
        ]}
      />
      <ErrorAlert message={error} />
      {entries === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : entries.length === 0 ? (
        <Muted>{t("audit.empty")}</Muted>
      ) : (
        <LedgerList>
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </LedgerList>
      )}
      {nextCursor && (
        <div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await load({ from, to }, kind, nextCursor);
              setBusy(false);
            }}
          >
            {t("audit.more")}
          </Button>
        </div>
      )}
    </>
  );
}
