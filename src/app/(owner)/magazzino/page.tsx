"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/components/use-me";
import { ErrorAlert, Field, Heading, LedgerList, Muted, Select } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { emptyFor } from "@/lib/empty/empty-content";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import type { StockItem } from "@/server/stock/types";
import { StockLinks } from "./stock-links";
import { StockRow } from "./stock-row";
import { WasteCostsLink } from "./waste-costs-link";

const FORBIDDEN = 403;

interface StockList {
  asOf: string;
  items: StockItem[];
}

/** The stock list. Reads /api/stock (quantities only, for every role) and /api/locations; the totals come from the server. */
export default function StockPage() {
  const [location, setLocation] = useState("");
  const [data, setData] = useState<StockList | null>(null);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  // The role comes from the one cached /api/me read shared with the app shell.
  const role = useMe().me?.user.role ?? null;
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(
    async (which: string) => {
      const isNewest = startRequest();
      const query = which ? `?location=${encodeURIComponent(which)}` : "";
      const result = await apiJson<StockList>(`/api/stock${query}`);
      // A slow answer for a location the user has left must not replace the newer one.
      if (!isNewest()) return;
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setError(null);
      setData(result.data);
    },
    [startRequest],
  );

  useEffect(() => {
    // The location filter is kept in ?location= so a reload or a shared link shows the same view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocation(new URLSearchParams(window.location.search).get("location") ?? "");
  }, []);

  useEffect(() => {
    // Loading the list when the page opens or the location changes is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(location);
  }, [location, load]);

  useEffect(() => {
    void (async () => {
      const result = await apiJson<{ locations: { id: string; name: string }[] }>("/api/locations");
      if (result.ok) setLocations(result.data.locations);
    })();
  }, []);

  function chooseLocation(value: string) {
    setLocation(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("location", value);
    else url.searchParams.delete("location");
    window.history.replaceState(null, "", url);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("stock.title")}</Heading>
        <ErrorAlert message={t("stock.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("stock.title")}</Heading>
      {locations.length > 0 && (
        <Field label={t("stock.location.label")}>
          <Select
            name="location"
            value={location}
            onChange={(event) => chooseLocation(event.target.value)}
          >
            <option value="">{t("stock.location.all")}</option>
            {locations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <StockLinks role={role} />
      <WasteCostsLink role={role} />
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : data.items.length === 0 ? (
        <EmptyState {...emptyFor("stock", role)} />
      ) : (
        <LedgerList>
          {data.items.map((item) => (
            <StockRow key={item.ingredientId} item={item} />
          ))}
        </LedgerList>
      )}
    </>
  );
}
