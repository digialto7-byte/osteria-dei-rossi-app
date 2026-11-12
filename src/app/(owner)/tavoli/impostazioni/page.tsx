"use client";

import { BackLink } from "@/components/back-link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  Heading,
  Muted,
  SubHeading,
  SuccessNote,
  TextInput,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { CopertoRead, DiningTable } from "@/server/tables/output";
import { TABLE_NAME_MAX, TABLE_POSITION_MAX } from "@/server/tables/constants";
import type { ServicePeriods } from "@/server/services/output";
import type { WeightSettings } from "@/server/menu/output";
import type { ReservationSettings, TableBooking } from "@/server/reservations/output";
import { CopertoCard } from "./coperto-card";
import { DiningTableRow, type DiningTablePatch } from "./dining-table-row";
import { BookingTablesCard } from "./booking-tables-card";
import { ReservationsCard } from "./reservations-card";
import { ServicesCard } from "./services-card";
import { WeightCard } from "./weight-card";
import { NEW_GROUP_KEY, TableGroupsCard } from "./table-groups-card";

const FORBIDDEN = 403;
const COPERTO_ID = "coperto";
const SERVICES_ID = "services";
const RESERVATIONS_ID = "reservations";
const BOOKING_ID = "booking";
const WEIGHT_ID = "weight";

// The page's own origin, for the preview of the public address. Empty in the server render.
const noSubscription = () => () => undefined;
const useOrigin = () =>
  useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  );

/**
 * The owner's and admin's table settings: the names and order of the tables, the "Attivo" switch, and the coperto.
 * Reads /api/dining-tables, /api/settings/coperto, /api/settings/services and /api/settings/weight; writes /api/dining-tables, /api/dining-tables/:id,
 * /api/settings/coperto and /api/settings/services (the service periods, M25c). The reservation cards (online bookings, bookable tables, table groups) read
 * /api/settings/reservations and /api/settings/reservations/tables and write them and /api/table-groups. Whether a change is allowed, and every error text, is the server's.
 */
export default function DiningTablesPage() {
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [coperto, setCoperto] = useState<CopertoRead | null>(null);
  const [services, setServices] = useState<ServicePeriods | null>(null);
  const [reservations, setReservations] = useState<ReservationSettings | null>(null);
  const [booking, setBooking] = useState<TableBooking | null>(null);
  const [weight, setWeight] = useState<WeightSettings | null>(null);
  // A failed read of the weight setting hides its card only.
  const [weightError, setWeightError] = useState<string | null>(null);
  // A failed read of the reservation settings hides the reservation cards only; the tables, the coperto and the services do not depend on it.
  const [reservationsError, setReservationsError] = useState<string | null>(null);
  const origin = useOrigin();
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [newError, setNewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, read, svc, resv, book, wt] = await Promise.all([
      apiJson<{ tables: DiningTable[] }>("/api/dining-tables"),
      apiJson<CopertoRead>("/api/settings/coperto"),
      apiJson<ServicePeriods>("/api/settings/services"),
      apiJson<ReservationSettings>("/api/settings/reservations"),
      apiJson<TableBooking>("/api/settings/reservations/tables"),
      apiJson<WeightSettings>("/api/settings/weight"),
    ]);
    const failed = [list, read, svc].find((result) => !result.ok);
    const reservationFailed = [resv, book].find((result) => !result.ok);
    if (failed && !failed.ok) {
      if (failed.status === FORBIDDEN) setForbidden(true);
      else setMessage(failed.error.message);
      return false;
    }
    if (reservationFailed && !reservationFailed.ok && reservationFailed.status === FORBIDDEN) {
      setForbidden(true);
      return false;
    }
    if (!wt.ok && wt.status === FORBIDDEN) {
      setForbidden(true);
      return false;
    }
    if (list.ok && read.ok && svc.ok) {
      setMessage(null);
      setWeight(wt.ok ? wt.data : null);
      setWeightError(wt.ok ? null : wt.error.message);
      setTables(list.data.tables);
      setCoperto(read.data);
      setServices(svc.data);
      if (resv.ok && book.ok) {
        setReservationsError(null);
        setReservations(resv.data);
        setBooking(book.data);
      } else {
        setReservations(null);
        setBooking(null);
        setReservationsError(
          reservationFailed && !reservationFailed.ok ? reservationFailed.error.message : null,
        );
      }
    }
    return true;
  }, []);

  useEffect(() => {
    // Loading the settings when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** One write for the record `id`: its error stays on that record; success reads everything again. */
  async function write(id: string, path: string, method: "POST" | "PATCH" | "PUT", body: unknown) {
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
      <BackLink href="/tavoli">{t("tables.settings.back")}</BackLink>
      <Heading>{t("tables.settings.title")}</Heading>
      <Muted>{t("tables.settings.hint")}</Muted>
      <ErrorAlert message={message} />
      {saved && <SuccessNote role="status">{t("tables.saved")}</SuccessNote>}
      {tables === null || coperto === null || services === null ? (
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
          {weight === null ? (
            <ErrorAlert message={weightError} />
          ) : (
            <WeightCard
              key={weight.weightMaxG}
              settings={weight}
              busy={busyId === WEIGHT_ID}
              error={errors[WEIGHT_ID] ?? null}
              onSave={(body) => void write(WEIGHT_ID, "/api/settings/weight", "PUT", body)}
            />
          )}
          <ServicesCard
            key={`${services.since ?? ""}:${services.periods.map((p) => `${p.key}|${p.name}|${p.startsAt}`).join(",")}`}
            services={services}
            busy={busyId === SERVICES_ID}
            error={errors[SERVICES_ID] ?? null}
            onSave={(body) => void write(SERVICES_ID, "/api/settings/services", "PATCH", body)}
          />
          {reservations === null || booking === null ? (
            <ErrorAlert message={reservationsError} />
          ) : (
            <>
              <ReservationsCard
                key={JSON.stringify(reservations)}
                settings={reservations}
                origin={origin}
                busy={busyId === RESERVATIONS_ID}
                error={errors[RESERVATIONS_ID] ?? null}
                onSave={(body) =>
                  void write(RESERVATIONS_ID, "/api/settings/reservations", "PATCH", body)
                }
              />
              <BookingTablesCard
                key={JSON.stringify(booking.tables)}
                booking={booking}
                busy={busyId === BOOKING_ID}
                error={errors[BOOKING_ID] ?? null}
                onSave={(body) =>
                  void write(BOOKING_ID, "/api/settings/reservations/tables", "PUT", body)
                }
              />
              <TableGroupsCard
                key={booking.groups.map((group) => group.id).join(",")}
                booking={booking}
                busyKey={busyId}
                errors={errors}
                onCreate={(body) => void write(NEW_GROUP_KEY, "/api/table-groups", "POST", body)}
                onDeactivate={(groupId) =>
                  void write(groupId, `/api/table-groups/${groupId}/deactivate`, "POST", {})
                }
              />
            </>
          )}
        </>
      )}
    </>
  );
}
