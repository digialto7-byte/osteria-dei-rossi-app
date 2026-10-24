"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  Heading,
  linkClass,
  Muted,
  SubHeading,
  SuccessNote,
  TextInput,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { CopertoRead, DiningTable } from "@/server/tables/output";
import { TABLE_NAME_MAX, TABLE_POSITION_MAX } from "@/server/tables/constants";
import { CopertoCard } from "./coperto-card";
import { DiningTableRow, type DiningTablePatch } from "./dining-table-row";

const FORBIDDEN = 403;
const COPERTO_ID = "coperto";

/**
 * The owner's and admin's table settings: the names and order of the tables, the "Attivo" switch, and the coperto.
 * Reads /api/dining-tables and /api/settings/coperto; writes /api/dining-tables, /api/dining-tables/:id and
 * /api/settings/coperto. Whether a change is allowed, and every error text, is the server's.
 */
export default function DiningTablesPage() {
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [coperto, setCoperto] = useState<CopertoRead | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [newError, setNewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, read] = await Promise.all([
      apiJson<{ tables: DiningTable[] }>("/api/dining-tables"),
      apiJson<CopertoRead>("/api/settings/coperto"),
    ]);
    const failed = [list, read].find((result) => !result.ok);
    if (failed && !failed.ok) {
      if (failed.status === FORBIDDEN) setForbidden(true);
      else setMessage(failed.error.message);
      return false;
    }
    if (list.ok && read.ok) {
      setMessage(null);
      setTables(list.data.tables);
      setCoperto(read.data);
    }
    return true;
  }, []);

  useEffect(() => {
    // Loading the settings when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** One write for the record `id`: its error stays on that record; success reads everything again. */
  async function write(id: string, path: string, method: "POST" | "PATCH", body: unknown) {
    setBusyId(id);
    setSaved(false);
    setErrors(({ [id]: _removed, ...rest }) => rest);
    const result = await apiJson(path, { method, body });
    let ok = false;
    if (!result.ok) {
      const failure = result.error.message;
      setErrors((current) => ({ ...current, [id]: failure }));
    } else if (await load()) {
      setSaved(true);
      ok = true;
    }
    setBusyId(null);
    return ok;
  }

  async function addTable() {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > TABLE_NAME_MAX) {
      return setNewError(t("tableError.name_invalid"));
    }
    const order = position.trim();
    if (order !== "" && (!/^\d{1,4}$/.test(order) || Number(order) > TABLE_POSITION_MAX)) {
      return setNewError(t("tables.error.position"));
    }
    setNewError(null);
    const body = order === "" ? { name: trimmed } : { name: trimmed, position: Number(order) };
    if (await write("new", "/api/dining-tables", "POST", body)) {
      setName("");
      setPosition("");
    }
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("tables.settings.title")}</Heading>
        <ErrorAlert message={t("tables.settings.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("tables.settings.title")}</Heading>
      <Link href="/tavoli" className={linkClass}>
        {t("tables.settings.back")}
      </Link>
      <Muted>{t("tables.settings.hint")}</Muted>
      <ErrorAlert message={message} />
      {saved && <SuccessNote role="status">{t("tables.saved")}</SuccessNote>}
      {tables === null || coperto === null ? (
        !message && <Muted>{t("common.loading")}</Muted>
      ) : (
        <>
          <Card role="group" aria-label={t("tables.new.title")} className="flex flex-col gap-3">
            <SubHeading>{t("tables.new.title")}</SubHeading>
            <Field label={t("common.name")}>
              <TextInput
                name="newName"
                value={name}
                disabled={busyId === "new"}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={t("tables.field.position")}>
              <TextInput
                name="newPosition"
                type="text"
                inputMode="numeric"
                value={position}
                disabled={busyId === "new"}
                onChange={(event) => setPosition(event.target.value)}
              />
            </Field>
            <ErrorAlert message={newError ?? errors.new ?? null} />
            <Button
              onClick={() => void addTable()}
              disabled={busyId === "new"}
              className="self-start"
            >
              {t("tables.add")}
            </Button>
          </Card>
          {tables.length === 0 ? (
            <Muted>{t("tables.empty")}</Muted>
          ) : (
            <div className="flex flex-col gap-3">
              {tables.map((table) => (
                <DiningTableRow
                  key={`${table.id}:${table.name}:${table.position}:${table.active}`}
                  table={table}
                  busy={busyId === table.id}
                  error={errors[table.id] ?? null}
                  onSave={(patch: DiningTablePatch) =>
                    void write(table.id, `/api/dining-tables/${table.id}`, "PATCH", patch)
                  }
                />
              ))}
            </div>
          )}
          <CopertoCard
            key={`${coperto.coperto?.amount ?? ""}:${coperto.coperto?.vatRate ?? ""}`}
            coperto={coperto.coperto}
            defaultVatRate={coperto.defaults.vatRate}
            vatRates={coperto.vatRates}
            busy={busyId === COPERTO_ID}
            error={errors[COPERTO_ID] ?? null}
            onSave={(body) => void write(COPERTO_ID, "/api/settings/coperto", "PATCH", body)}
          />
        </>
      )}
    </>
  );
}
