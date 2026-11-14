"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CsvLink } from "@/components/csv-link";
import { ErrorAlert, Heading, LedgerList, Muted, linkClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { formatEur } from "@/lib/dashboard/dashboard-view";
import { csvHref } from "@/lib/exports/export-links";
import { formatPricePerEtto } from "@/lib/money/format";
import { t, tn } from "@/lib/i18n";
import { canPush } from "@/lib/push/push-access";
import type { ManageMenu } from "@/server/menu/output";
import type { PushListOutput } from "@/server/push/output";
import { PushRow } from "./push-row";
import { PushSheet } from "./push-sheet";
import { SellThroughPanel } from "./sell-through-panel";

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
  // The menu price of each dish and whether it is sold by weight (its prices are then per 100 g); read for owner and admin only.
  const [prices, setPrices] = useState<ReadonlyMap<
    string,
    { price: number; perEtto: boolean }
  > | null>(null);
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

  /** The menu prices and units, read once (owner and admin only): the sheet shows the price the day's price cannot pass. */
  // One read at a time: the effect and "Spingi oggi" share the same in-flight promise.
  const inFlight = useRef<Promise<void> | null>(null);
  const loadPrices = useCallback((): Promise<void> => {
    inFlight.current ??= readPrices().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
    async function readPrices() {
      const menu = await apiJson<ManageMenu>("/api/menu/items");
      if (!menu.ok) return;
      setPrices(
        new Map(
          menu.data.items.map((item) => [
            item.id,
            { price: item.price, perEtto: item.priceUnit === "etto" },
          ]),
        ),
      );
    }
  }, []);

  async function openSheet(rowId: string, plate: Plate) {
    setSheetError(null);
    setRowError(null);
    setSheet({ rowId, plate });
    if (prices === null) await loadPrices();
  }

  // A pushed plate shows its push price, which is per 100 g for a dish sold by weight: that needs the menu's units without
  // waiting for a sheet to open. Without a shown price (or for the chef) the menu is not read.
  const needsUnits =
    data !== null &&
    canPush(data.role) &&
    prices === null &&
    data.rows.some((row) =>
      row.plates.some((plate) => plate.pushed && "pushPrice" in plate && plate.pushPrice !== null),
    );
  useEffect(() => {
    // Reading the menu units when a pushed price is on screen is the effect's job here.
    if (needsUnits) void loadPrices();
  }, [needsUnits, loadPrices]);

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
      const menu = prices?.get(plate.menuItemId);
      const text =
        result.error.code === "push_price_above_menu" && menu !== undefined
          ? t("push.sheet.aboveMenu", {
              price: menu.perEtto ? formatPricePerEtto(menu.price) : formatEur(menu.price),
            })
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
  const perEttoIds = new Set(
    [...(prices ?? [])].filter(([, menu]) => menu.perEtto).map(([id]) => id),
  );
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
              perEtto={manager && prices === null ? null : perEttoIds}
            >
              {manager && sheet && sheet.rowId === row.id ? (
                <PushSheet
                  key={sheet.plate.menuItemId}
                  plateName={sheet.plate.name}
                  menuPrice={prices?.get(sheet.plate.menuItemId)?.price ?? null}
                  perEtto={prices?.get(sheet.plate.menuItemId)?.perEtto ?? false}
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
      <SellThroughPanel />
    </>
  );
}
