"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { CollapsibleAdd, useCollapsibleAdd } from "@/components/collapsible-add";
import {
  ErrorAlert,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  SuccessNote,
  linkClass,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { otherRole, type StaffItem } from "@/lib/staff-auth/staff-view";
import { PinForm } from "./pin-form";
import { StaffForm } from "./staff-form";
import { StaffRow } from "./staff-row";

const FORBIDDEN = 403;

/** Reads /api/users; every change goes through /api/users*. No rule of its own. */
export default function StaffPage() {
  const [staff, setStaff] = useState<StaffItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const add = useCollapsibleAdd(staff?.length ?? null);

  const load = useCallback(async () => {
    const result = await apiJson<{ staff: StaffItem[] }>("/api/users");
    if (result.ok) {
      setStaff(result.data.staff);
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

  async function patch(item: StaffItem, body: Record<string, unknown>) {
    setBusyId(item.id);
    setNote(null);
    const result = await apiJson(`/api/users/${item.id}`, { method: "PATCH", body });
    setBusyId(null);
    if (!result.ok) return setError(result.error.message);
    await load();
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("staff.title")}</Heading>
        <ErrorAlert message={t("staff.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("staff.title")}</Heading>
      <CollapsibleAdd label={t("staff.addButton")} open={add.open} onShow={add.show}>
        <StaffForm
          onAdded={(name) => {
            setNote(t("staff.added", { name }));
            add.hide();
            void load();
          }}
        />
      </CollapsibleAdd>
      {note && <SuccessNote role="status">{note}</SuccessNote>}
      <ErrorAlert message={error} />
      {staff === null ? (
        <Muted>{t("pin.loading")}</Muted>
      ) : staff.length === 0 ? (
        <Muted>{t("staff.empty")}</Muted>
      ) : (
        <LedgerList>
          {staff.map((item) => (
            <Fragment key={item.id}>
              <StaffRow
                item={item}
                busy={busyId === item.id}
                onPin={(target) => setPinFor(target.id)}
                onToggle={(target) => patch(target, { active: !target.active })}
                onRole={(target) => patch(target, { role: otherRole(target.role) })}
              />
              {pinFor === item.id && (
                <LedgerRow className="pb-3">
                  <PinForm
                    item={item}
                    onCancel={() => setPinFor(null)}
                    onSaved={(saved) => {
                      setPinFor(null);
                      setNote(t("staff.pinSaved", { name: saved.displayName }));
                      void load();
                    }}
                  />
                </LedgerRow>
              )}
            </Fragment>
          ))}
        </LedgerList>
      )}
      <Link href="/dispositivi" className={linkClass}>
        {t("staff.devicesLink")}
      </Link>
    </>
  );
}
