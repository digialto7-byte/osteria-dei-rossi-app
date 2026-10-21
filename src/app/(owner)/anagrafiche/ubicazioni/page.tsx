"use client";

import { useState, type FormEvent } from "react";
import { Button, Checkbox, ErrorAlert, Field, Heading, TextInput } from "@/components/ui";
import { useApiList } from "@/components/use-api-list";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";

interface Location {
  id: string;
  name: string;
  isActive: boolean;
}

export default function LocationsPage() {
  const list = useApiList<Location>("/api/locations", "locations");
  const [name, setName] = useState("");

  async function create(event: FormEvent) {
    event.preventDefault();
    const result = await apiJson("/api/locations", { method: "POST", body: { name } });
    if (!result.ok) return list.setError(result.error.message);
    setName("");
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
      <form onSubmit={create} className="flex flex-col gap-3" aria-label={t("locations.new")}>
        <Field label={t("common.name")}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </Field>
        <Button type="submit">{t("common.add")}</Button>
      </form>
      <ErrorAlert message={list.error} />
      <Checkbox
        label={t("common.showInactive")}
        checked={list.showInactive}
        onChange={(e) => list.setShowInactive(e.target.checked)}
      />
      {list.items === null ? (
        <p>{t("common.loading")}</p>
      ) : list.items.length === 0 ? (
        <p>{t("common.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-stone-200">
          {list.items.map((location) => (
            <li key={location.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                {location.name}
                {!location.isActive && (
                  <span className="text-stone-600"> ({t("common.inactive")})</span>
                )}
              </span>
              <Button variant="secondary" onClick={() => toggle(location)}>
                {location.isActive ? t("common.deactivate") : t("common.reactivate")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
