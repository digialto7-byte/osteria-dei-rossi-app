"use client";

import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { useCallback, useEffect, useState } from "react";
import {
  ErrorAlert,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  SubHeading,
  linkClass,
} from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { useMe } from "@/components/use-me";
import { emptyFor } from "@/lib/empty/empty-content";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { pendingCodeLine } from "@/lib/staff-auth/device-view";
import type { DeviceOverview, DeviceView } from "@/server/staff-auth/types";
import { CodeCard } from "./code-card";
import { CodeForm, type NewCode } from "./code-form";
import { DeviceRow } from "./device-row";

const FORBIDDEN = 403;

/** Reads /api/devices; creating, unlocking and revoking go through /api/devices*. */
export default function DevicesPage() {
  const role = useMe().me?.user.role ?? null;
  const [overview, setOverview] = useState<DeviceOverview | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<NewCode | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiJson<DeviceOverview>("/api/devices");
    if (result.ok) {
      setOverview(result.data);
      setError(null);
    } else if (result.status === FORBIDDEN) {
      setForbidden(true);
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    // Loading the list when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(device: DeviceView, method: "DELETE" | "POST", path: string) {
    setBusyId(device.id);
    const result = await apiJson(path, { method, body: method === "POST" ? {} : undefined });
    setBusyId(null);
    setConfirmId(null);
    if (!result.ok) return setError(result.error.message);
    await load();
  }

  if (forbidden) {
    return (
      <>
        <BackLink href="/personale">{t("devices.back")}</BackLink>
        <Heading>{t("devices.title")}</Heading>
        <ErrorAlert message={t("staff.forbidden")} />
      </>
    );
  }

  return (
    <>
      <BackLink href="/personale">{t("devices.back")}</BackLink>
      <Heading>{t("devices.title")}</Heading>
      <CodeForm
        onCreated={(created) => {
          setCode(created);
          void load();
        }}
      />
      {/* The code only exists after a tap in this browser, so window is there. */}
      {code && <CodeCard {...code} address={`${window.location.host}/dispositivo`} />}
      <ErrorAlert message={error} />
      {overview === null ? (
        <Muted>{t("pin.loading")}</Muted>
      ) : overview.devices.length === 0 ? (
        <EmptyState {...emptyFor("devices", role)} />
      ) : (
        <LedgerList>
          {overview.devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              confirming={confirmId === device.id}
              busy={busyId === device.id}
              onUnlock={(target) => act(target, "POST", `/api/devices/${target.id}/unlock`)}
              onAskRevoke={(target) => setConfirmId(target.id)}
              onConfirmRevoke={(target) => act(target, "DELETE", `/api/devices/${target.id}`)}
              onCancelRevoke={() => setConfirmId(null)}
            />
          ))}
        </LedgerList>
      )}
      {overview && overview.pendingCodes.length > 0 && (
        <section className="flex flex-col gap-2">
          <SubHeading>{t("devices.pending")}</SubHeading>
          <LedgerList>
            {overview.pendingCodes.map((pending) => (
              <LedgerRow key={pending.id} className="num py-3 text-sm">
                {pendingCodeLine(pending)}
              </LedgerRow>
            ))}
          </LedgerList>
        </section>
      )}
      <Link href="/personale" className={linkClass}>
        {t("devices.staffLink")}
      </Link>
    </>
  );
}
