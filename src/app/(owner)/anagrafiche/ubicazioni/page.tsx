"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  TextInput,
  SuccessNote,
} from "@/components/ui";
import { useApiList } from "@/components/use-api-list";
import { useMe } from "@/components/use-me";
import { useSuccessNote } from "@/components/use-success-note";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { canEditMasterData } from "@/lib/master/master-access";

interface Location {
  id: string;
  name: string;
  isActive: boolean;
}

export default function LocationsPage() {
  const list = useApiList<Location>("/api/locations", "locations");
  const [name, setName] = useState("");
  const feedback = useSuccessNote();
  // Only owner and admin write master data (the API refuses the others); until the role is known no form shows.
  const role = useMe().me?.user.role ?? null;
  const canEdit = role !== null && canEditMasterData(role);

  async function create(event: FormEvent) {
    event.preventDefault();
    const result = await apiJson("/api/locations", { method: "POST", body: { name } });
    if (!result.ok) return list.setError(result.error.message);
    setName("");
    feedback.show(t("locations.added"));
    await list.reload();
  }

  async function toggle(location: Location) {
    const result = await apiJson(`/api/locations/${location.id}`, {
      method: "PATCH",
      body: { isActive: !location.isActive },
    });
    if (!result.ok) return list.setError(result.error.message);
    await list.reload();
  }

  return (
    <>
      <Heading>{t("locations.title")}</Heading>
      {canEdit && (
        <Card>
          <form onSubmit={create} className="flex flex-col gap-4" aria-label={t("locations.new")}>
            <Field label={t("common.name")}>
              <TextInput
                value={name}
                onChange={(e) => {
                  feedback.clear();
                  setName(e.target.value);
                }}
                required
                maxLength={80}
              />
            </Field>
            <Button type="submit">{t("common.add")}</Button>
          </form>
        </Card>
      )}
      {feedback.note && <SuccessNote role="status">{feedback.note}</SuccessNote>}
      <ErrorAlert message={list.error} />
      <Checkbox
        label={t("common.showInactive")}
        checked={list.showInactive}
        onChange={(e) => list.setShowInactive(e.target.checked)}
      />
      {list.items === null ? (
        !list.error && <Muted>{t("common.loading")}</Muted>
      ) : list.items.length === 0 ? (
        <Muted>{t("common.empty")}</Muted>
      ) : (
        <LedgerList>
          {list.items.map((location) => (
            <LedgerRow key={location.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-bold">{location.name}</span>
                {!location.isActive && (
                  <span className="text-ink-muted"> ({t("common.inactive")})</span>
                )}
              </span>
              {canEdit && (
                <Button variant="secondary" onClick={() => toggle(location)}>
                  {location.isActive ? t("common.deactivate") : t("common.reactivate")}
                </Button>
              )}
            </LedgerRow>
          ))}
        </LedgerList>
      )}
    </>
  );
}
