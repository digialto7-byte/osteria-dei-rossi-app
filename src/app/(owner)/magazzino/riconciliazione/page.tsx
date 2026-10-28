"use client";

import { BackLink } from "@/components/back-link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorAlert, Field, Heading, LedgerList, Muted, Select, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import type { Reconciliation } from "@/server/counts/types";
import { ReconciliationRow } from "./reconciliation-row";

const FORBIDDEN = 403;

/**
 * Opening + receipts - consumption - waste +/- adjustments = closing, per ingredient. Reads /api/reports/reconciliation
 * (quantities only); the default period (the Rome month so far) is the server's. With two or more locations one must
 * be chosen: the first is used until the user picks another.
 */
export default function ReconciliationPage() {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [location, setLocation] = useState("");
  const [locations, setLocations] = useState<{ id: string; name: string }[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(
    async (range: { from: string; to: string } | null, place: string) => {
      const isNewest = startRequest();
      const query = new URLSearchParams();
      if (range) {
        query.set("from", range.from);
        query.set("to", range.to);
      }
      if (place) query.set("location", place);
      const text = query.toString();
      const result = await apiJson<Reconciliation>(
        `/api/reports/reconciliation${text ? `?${text}` : ""}`,
      );
      if (!isNewest()) return;
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setError(null);
      setData(result.data);
      // The inputs start from what the server answered, so the dates shown are the dates used.
      setFrom(result.data.from);
      setTo(result.data.to);
    },
    [startRequest],
  );

  useEffect(() => {
    void (async () => {
      const places = await apiJson<{ locations: { id: string; name: string }[] }>("/api/locations");
      const list = places.ok ? places.data.locations : [];
      setLocations(list);
      const first = list.length >= 2 ? list[0]!.id : "";
      setLocation(first);
      await load(null, first);
    })();
  }, [load]);

  function change(next: { from: string; to: string }, place = location) {
    setFrom(next.from);
    setTo(next.to);
    if (next.from && next.to) void load(next, place);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("reconciliation.title")}</Heading>
        <ErrorAlert message={t("count.forbidden")} />
      </>
    );
  }

  return (
    <>
      <BackLink href="/magazzino">{t("stock.costs.back")}</BackLink>
      <Heading>{t("reconciliation.title")}</Heading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("reconciliation.from")}>
          <TextInput
            type="date"
            name="from"
            value={from}
            max={to || undefined}
            onChange={(event) => change({ from: event.target.value, to })}
          />
        </Field>
        <Field label={t("reconciliation.to")}>
          <TextInput
            type="date"
            name="to"
            value={to}
            min={from || undefined}
            onChange={(event) => change({ from, to: event.target.value })}
          />
        </Field>
      </div>
      {locations && locations.length >= 2 && (
        <Field label={t("count.location.label")}>
          <Select
            name="location"
            value={location}
            onChange={(event) => {
              setLocation(event.target.value);
              change({ from, to }, event.target.value);
            }}
          >
            {locations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : data.items.length === 0 ? (
        <Muted>{t("reconciliation.empty")}</Muted>
      ) : (
        <LedgerList>
          {data.items.map((item) => (
            <ReconciliationRow key={item.ingredientId} item={item} />
          ))}
        </LedgerList>
      )}
    </>
  );
}
