"use client";

import { useState } from "react";
import { Badge, Button, Card, Muted, SubHeading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { dayServiceRow, daySessionLine } from "@/lib/services/services-view";
import type { DayServices } from "@/server/services/output";
import { ServiceSwitch } from "./service-switch";

/**
 * The app's day split by service (M25c): one row per service with tables, covers and the frozen total, the day total, and a list of the day's
 * tables with their service and a "Cambia servizio" button. The register stays one total per day, so the difference is on the total (the card
 * says so). Every figure and every `canChange` is the database's. `onMove` resolves to the server's refusal, or null when the move was saved.
 */
export function DayServicesCard({
  data,
  onMove,
}: {
  data: DayServices;
  onMove: (sessionId: string, serviceKey: string | null) => Promise<string | null>;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (key: string) => data.services.find((s) => s.key === key)?.name ?? key;
  const session = data.sessions.find((s) => s.sessionId === editing) ?? null;

  async function confirm(serviceKey: string | null) {
    if (!session) return;
    setBusy(true);
    setError(null);
    const refusal = await onMove(session.sessionId, serviceKey);
    setBusy(false);
    if (refusal) return setError(refusal);
    setEditing(null);
  }

  return (
    <Card role="group" aria-label={t("dayClose.services.title")} className="flex flex-col gap-3">
      <SubHeading>{t("dayClose.services.title")}</SubHeading>
      <ul className="flex flex-col gap-1 tabular-nums">
        {data.services.map((service) => (
          <li key={service.key} data-service-key={service.key}>
            {dayServiceRow(service)}
          </li>
        ))}
      </ul>
      <p className="text-lg font-bold tabular-nums">
        {t("dayClose.services.total", { amount: formatEuro(data.total.totalEur) })}
      </p>
      <Muted>{t("dayClose.services.note")}</Muted>
      <Button
        variant="secondary"
        aria-expanded={listOpen}
        onClick={() => setListOpen((value) => !value)}
        className="self-start"
      >
        {t("dayClose.services.list")}
      </Button>
      {listOpen && (
        <ul className="flex flex-col gap-2">
          {data.sessions.map((row) => (
            <li
              key={row.sessionId}
              data-session-id={row.sessionId}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span>{daySessionLine(row.tableName, row.openedAt, nameOf(row.serviceKey))}</span>
              {row.source === "override" && (
                <Badge tone="info">{t("dayClose.services.moved")}</Badge>
              )}
              {row.canChange && (
                <Button
                  variant="quiet"
                  aria-label={t("dayClose.services.changeAria", { table: row.tableName })}
                  onClick={() => {
                    setError(null);
                    setEditing(row.sessionId);
                  }}
                >
                  {t("dayClose.services.change")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {session && (
        <ServiceSwitch
          key={session.sessionId}
          session={session}
          nameOf={nameOf}
          busy={busy}
          error={error}
          onConfirm={(key) => void confirm(key)}
          onCancel={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
