"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CsvLink } from "@/components/csv-link";
import { ErrorAlert, Heading, LedgerList, Muted, linkClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { formatEur } from "@/lib/dashboard/dashboard-view";
import { csvHref } from "@/lib/exports/export-links";
import { t, tn } from "@/lib/i18n";
import { canPush } from "@/lib/push/push-access";
import type { ManageMenu } from "@/server/menu/output";
import type { PushListOutput } from "@/server/push/output";
import { PushRow } from "./push-row";
import { PushSheet } from "./push-sheet";

const FORBIDDEN = 403;

type Plate = PushListOutput["rows"][number]["plates"][number];

function expiredFooter(expired: { batches: number; lots: number }): string | null {
  const { batches, lots } = expired;
  if (batches === 0 && lots === 0) return null;
  if (batches > 0 && lots > 0) {
    return t("push.expired.both", {
      batches: tn("push.expired.batches", batches),
      lots: tn("push.expired.lots", lots),
    });
  }
  return batches > 0 ? tn("push.expired.batchesOnly", batches) : tn("push.expired.lotsOnly", lots);
}

/**
 * "Da spingere" (M23 plan §3.5): the list of dishes and ingredients about to expire, with the plates that use them. Reads
 * /api/reports/push-list; the owner and the admin push or remove a push with POST /api/menu/:id/push and the list is read again. The chef reads
 * the same list with no euro and no button. Every number, hour and order comes with the JSON.
 */
export default function PushPage() {
  const [data, setData] = useState<PushListOutput | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ rowId: string; plate: Plate } | null>(null);
  const [rowError, setRowError] = useState<{ rowId: string; text: string } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prices, setPrices] = useState<ReadonlyMap<string, number> | null>(null);
  const start = useRef(latestOnly()).current;

  const load = useCallback(async () => {
    const isNewest = start();
    const result = await apiJson<PushListOutput>("/api/reports/push-list");
    if (!isNewest()) return;
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setError(result.error.message);
      return;
    }
    setError(null);
    setData(result.data);
  }, [start]);

  useEffect(() => {
    // Reading the list when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** The menu prices, read once when the first sheet opens (owner and admin only): the sheet shows the price the day's price cannot pass. */
  async function openSheet(rowId: string, plate: Plate) {
    setSheetError(null);
    setRowError(null);
    setSheet({ rowId, plate });
    if (prices === null) {
      const menu = await apiJson<ManageMenu>("/api/menu/items");
      if (menu.ok) setPrices(new Map(menu.data.items.map((item) => [item.id, item.price])));
    }
  }

  async function send(
    rowId: string,
    plate: Plate,
    body: { pushed: boolean; pushPrice?: number | null },
  ) {
    setBusy(true);
    setRowError(null);
    const result = await apiJson(`/api/menu/${plate.menuItemId}/push`, { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      const menuPrice = prices?.get(plate.menuItemId);
      const text =
        result.error.code === "push_price_above_menu" && menuPrice !== undefined
          ? t("push.sheet.aboveMenu", { price: formatEur(menuPrice) })
          : result.error.message;
      if (sheet?.rowId === rowId && sheet.plate.menuItemId === plate.menuItemId)
        setSheetError(text);
      else setRowError({ rowId, text });
      return;
    }
    setSheet(null);
    setSheetError(null);
    await load();
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("push.title")}</Heading>
        <ErrorAlert message={t("push.forbidden")} />
      </>
    );
  }
  const manager = data ? canPush(data.role) : false;
  const footer = data ? expiredFooter(data.expired) : null;
  return (
    <>
      <Heading>{t("push.title")}</Heading>
      {data !== null ? <CsvLink href={csvHref("push-list")} /> : null}
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : data.rows.length === 0 ? (
        <Muted>{t("dashboard.empty.pushList")}</Muted>
      ) : (
        <LedgerList>
          {data.rows.map((row) => (
            <PushRow
              key={row.id}
              row={row}
              role={data.role}
              busy={busy}
              onPush={(plate) => void openSheet(row.id, plate)}
              onStop={(plate) => void send(row.id, plate, { pushed: false })}
              error={rowError?.rowId === row.id ? rowError.text : null}
            >
              {manager && sheet && sheet.rowId === row.id ? (
                <PushSheet
                  key={sheet.plate.menuItemId}
                  plateName={sheet.plate.name}
                  menuPrice={prices?.get(sheet.plate.menuItemId) ?? null}
                  busy={busy}
                  error={sheetError}
                  onConfirm={(pushPrice) =>
                    void send(row.id, sheet.plate, { pushed: true, pushPrice })
                  }
                  onCancel={() => setSheet(null)}
                />
              ) : null}
            </PushRow>
          ))}
        </LedgerList>
      )}
      {footer ? (
        <div className="flex flex-col gap-1">
          <p>{footer}</p>
          <div className="flex flex-wrap gap-4">
            {data && data.expired.batches > 0 ? (
              <Link href="/produzione" className={linkClass}>
                {t("push.expired.openProduction")}
              </Link>
            ) : null}
            {data && data.expired.lots > 0 ? (
              <Link href="/magazzino" className={linkClass}>
                {t("push.expired.openStock")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      {data && data.unresolvedRecipes > 0 ? <Muted>{t("push.unresolved")}</Muted> : null}
    </>
  );
}
