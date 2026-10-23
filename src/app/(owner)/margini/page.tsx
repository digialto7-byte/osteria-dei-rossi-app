"use client";

import { useEffect, useState } from "react";
import { ErrorAlert, Heading, LedgerList, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { PlateMarginPct } from "@/server/costing/types";
import { MarginRow } from "./margin-row";

const FORBIDDEN = 403;

/**
 * The chef's margins: food cost %, GP % and a status per plate, no euro anywhere (V6). Reads
 * /api/costs/plates/percentages only; owner and admin may open it too, the waiter is refused.
 */
export default function MarginsPage() {
  const [plates, setPlates] = useState<PlateMarginPct[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await apiJson<{ plates: PlateMarginPct[] }>("/api/costs/plates/percentages");
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setPlates(result.data.plates);
    })();
  }, []);

  if (forbidden) {
    return (
      <>
        <Heading>{t("margins.title")}</Heading>
        <ErrorAlert message={t("margins.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("margins.title")}</Heading>
      <ErrorAlert message={error} />
      {plates === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : plates.length === 0 ? (
        <Muted>{t("margins.empty")}</Muted>
      ) : (
        <>
          <LedgerList>
            {plates.map((plate) => (
              <MarginRow key={plate.recipeKey} plate={plate} />
            ))}
          </LedgerList>
          <p className="text-sm text-ink-muted">{t("margins.note")}</p>
        </>
      )}
    </>
  );
}
