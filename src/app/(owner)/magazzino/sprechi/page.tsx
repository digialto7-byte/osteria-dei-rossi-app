"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorAlert, Field, Heading, linkClass, Muted, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import type { WasteCosts } from "@/server/stock/types";
import { WasteCostsView } from "./waste-costs";

const FORBIDDEN = 403;

/** Waste in EUR for owner and admin. Reads /api/stock/waste-costs only; the default range (the month so far) is the server's. */
export default function WasteCostsPage() {
  const [data, setData] = useState<WasteCosts | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(
    async (range: { from: string; to: string } | null) => {
      const isNewest = startRequest();
      const query = range ? `?from=${range.from}&to=${range.to}` : "";
      const result = await apiJson<WasteCosts>(`/api/stock/waste-costs${query}`);
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
    // Loading the report when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  function change(next: { from: string; to: string }) {
    setFrom(next.from);
    setTo(next.to);
    if (next.from && next.to) void load(next);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("stock.costs.title")}</Heading>
        <ErrorAlert message={t("stock.costs.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("stock.costs.title")}</Heading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("stock.costs.from")}>
          <TextInput
            type="date"
            name="from"
            value={from}
            max={to || undefined}
            onChange={(event) => change({ from: event.target.value, to })}
          />
        </Field>
        <Field label={t("stock.costs.to")}>
          <TextInput
            type="date"
            name="to"
            value={to}
            min={from || undefined}
            onChange={(event) => change({ from, to: event.target.value })}
          />
        </Field>
      </div>
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : (
        <WasteCostsView data={data} />
      )}
      <Link href="/magazzino" className={`${linkClass} self-start`}>
        ← {t("stock.costs.back")}
      </Link>
    </>
  );
}
