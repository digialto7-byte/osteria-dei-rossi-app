"use client";

import { useCallback, useEffect, useState } from "react";
import { EnrolFactor } from "@/components/mfa/enrol-factor";
import { LiveError } from "@/components/mfa/live-error";
import { Button, Card, LedgerList, LedgerRow, Muted, SubHeading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import type { MfaSlot } from "@/lib/auth/mfa-constants";
import { factorRows, mfaErrorMessage, type FactorRow } from "@/lib/auth/mfa-view";
import { t, tn } from "@/lib/i18n";
import { formatCalendarDate } from "@/lib/time/format";
import { venueDate } from "@/lib/time/venue-date";
import type { MfaAccounts, MfaStatus } from "@/server/auth/mfa-schemas";

type Adding = { slot: MfaSlot } | null;

/** One row: the slot's name and state, with Aggiungi, Rimuovi or a confirm. */
function Row({
  row,
  onAdd,
  onRemoved,
}: {
  row: FactorRow;
  onAdd: (slot: MfaSlot) => void;
  onRemoved: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = t(`mfa.list.slot.${row.slot}`);
  const state =
    row.state === "verified"
      ? t("mfa.list.activeSince", {
          date: formatCalendarDate(venueDate(new Date(row.activeSince!))),
        })
      : row.state === "incomplete"
        ? t("mfa.list.incomplete")
        : t("mfa.list.notConfigured");

  async function remove() {
    if (busy || !row.factorId) return;
    setBusy(true);
    setError(null);
    const result = await apiJson(`/api/me/mfa/factors/${row.factorId}`, { method: "DELETE" });
    setBusy(false);
    if (result.ok) {
      setAsking(false);
      onRemoved();
      return;
    }
    setError(mfaErrorMessage(result.error));
  }

  return (
    <LedgerRow className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-bold text-ink">{label}</span>
          <span className="text-ink-muted"> · {state}</span>
        </span>
        {row.canAdd && (
          <Button variant="secondary" onClick={() => onAdd(row.slot as MfaSlot)}>
            {t("mfa.list.add")}
          </Button>
        )}
        {row.canRemove && !asking && (
          <Button variant="secondary" onClick={() => setAsking(true)}>
            {t("mfa.list.remove")}
          </Button>
        )}
      </div>
      {asking && (
        <div role="group" aria-label={t("mfa.list.removeAsk")} className="flex flex-col gap-2">
          <p className="[overflow-wrap:anywhere]">{t("mfa.list.removeAsk")}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={remove} disabled={busy}>
              {t("common.confirm")}
            </Button>
            <Button variant="quiet" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      <LiveError message={error} />
    </LedgerRow>
  );
}

function OtherAccounts({ accounts }: { accounts: MfaAccounts["accounts"] }) {
  return (
    <section className="flex flex-col gap-3">
      {accounts.length > 0 && (
        <>
          <SubHeading>{t("mfa.accounts.title")}</SubHeading>
          <LedgerList>
            {accounts.map((account) => (
              <LedgerRow key={account.id} className="flex flex-wrap items-center gap-x-2">
                <span className="font-bold text-ink [overflow-wrap:anywhere]">
                  {account.displayName}
                </span>
                <span className="text-ink-muted">· {t(`role.${account.role}`)}</span>
                <span className="text-ink-muted">
                  ·{" "}
                  {account.factorCount === 0
                    ? t("mfa.accounts.devices.none")
                    : tn("mfa.accounts.devices", account.factorCount)}
                </span>
              </LedgerRow>
            ))}
          </LedgerList>
        </>
      )}
      <Muted>{t("mfa.accounts.digialto")}</Muted>
    </section>
  );
}

/** The /doppia-verifica body: the account's own factors (GET /api/me/mfa) and the read-only other accounts (GET /api/mfa/accounts). No reset in the app (Q-T1 = V1). */
export function FactorList() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [accounts, setAccounts] = useState<MfaAccounts["accounts"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding>(null);

  const load = useCallback(async () => {
    const [self, others] = await Promise.all([
      apiJson<MfaStatus>("/api/me/mfa"),
      apiJson<MfaAccounts>("/api/mfa/accounts"),
    ]);
    if (self.ok) setStatus(self.data);
    else setError(self.error.message);
    if (others.ok) setAccounts(others.data.accounts);
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [self, others] = await Promise.all([
        apiJson<MfaStatus>("/api/me/mfa"),
        apiJson<MfaAccounts>("/api/mfa/accounts"),
      ]);
      if (!live) return;
      if (self.ok) setStatus(self.data);
      else setError(self.error.message);
      if (others.ok) setAccounts(others.data.accounts);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (adding) {
    return (
      <EnrolFactor
        slot={adding.slot}
        offerBackup={false}
        onCancel={() => setAdding(null)}
        onFinished={() => {
          setAdding(null);
          void load();
        }}
      />
    );
  }

  if (error && status === null) return <LiveError message={error} />;
  if (status === null) return <Muted>{t("common.loading")}</Muted>;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4">
        <LedgerList>
          {factorRows(status).map((row) => (
            <Row
              key={row.slot}
              row={row}
              onAdd={(slot) => setAdding({ slot })}
              onRemoved={() => void load()}
            />
          ))}
        </LedgerList>
      </Card>
      {accounts !== null && <OtherAccounts accounts={accounts} />}
    </div>
  );
}
