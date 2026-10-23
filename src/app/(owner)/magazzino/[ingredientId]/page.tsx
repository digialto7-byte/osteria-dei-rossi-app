"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  ErrorAlert,
  Heading,
  LedgerList,
  linkClass,
  Muted,
  SubHeading,
  SuccessNote,
  warningNoteClass,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { formatStockQty } from "@/lib/stock/stock-view";
import type { StockInputUnit } from "@/server/stock/constants";
import type {
  BaseUnit,
  LotItem,
  OutflowResult,
  ReverseResult,
  StockItem,
  StockOperation,
  TransferResult,
} from "@/server/stock/types";
import { DETAIL_LIST_CLASS } from "../../fatture/detail";
import { LotRow } from "./lot-row";
import { OperationRow } from "./operation-row";
import { TransferForm, type TransferValues } from "./transfer-form";
import { WasteForm, type WasteValues } from "./waste-form";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

interface LotsData {
  ingredient: { id: string; name: string; baseUnit: BaseUnit };
  today: string;
  units: StockInputUnit[];
  locations: { id: string; name: string }[];
  lots: LotItem[];
}
interface HistoryData {
  operations: StockOperation[];
  nextCursor: string | null;
}

/**
 * One ingredient: what is in each location, the lots first-expiring first, the waste and transfer forms and the
 * history with "Annulla". Reads /api/stock, /api/stock/lots and /api/stock/movements only, and writes through the
 * three stock POST routes. FEFO, quantities and the reversible flag are the server's; nothing is computed here.
 */
export default function StockDetailPage({ params }: { params: Promise<{ ingredientId: string }> }) {
  const { ingredientId } = use(params);
  const [item, setItem] = useState<StockItem | null>(null);
  const [lots, setLots] = useState<LotsData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [negativeNote, setNegativeNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [stock, lotsResult, movements] = await Promise.all([
      apiJson<{ items: StockItem[] }>("/api/stock"),
      apiJson<LotsData>(`/api/stock/lots?ingredient=${ingredientId}`),
      apiJson<HistoryData>(`/api/stock/movements?ingredient=${ingredientId}`),
    ]);
    for (const result of [lotsResult, stock, movements]) {
      if (result.ok) continue;
      if (result.status === FORBIDDEN) return setMessage(t("stock.forbidden"));
      if (result.status === NOT_FOUND) return setMessage(t("stock.notFound"));
      return setError(result.error.message);
    }
    if (!stock.ok || !lotsResult.ok || !movements.ok) return;
    setError(null);
    setItem(stock.data.items.find((entry) => entry.ingredientId === ingredientId) ?? null);
    setLots(lotsResult.data);
    setHistory(movements.data);
  }, [ingredientId]);

  useEffect(() => {
    // Loading the stock when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function showMore() {
    if (!history?.nextCursor) return;
    setBusy(true);
    const result = await apiJson<HistoryData>(
      `/api/stock/movements?ingredient=${ingredientId}&before=${encodeURIComponent(history.nextCursor)}`,
    );
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setHistory({
      operations: [...history.operations, ...result.data.operations],
      nextCursor: result.data.nextCursor,
    });
  }

  /** Runs a write, then re-reads the screen. Resolves true when it went through, so a form can clear itself. */
  async function write<T>(path: string, body: unknown): Promise<T | null> {
    setBusy(true);
    setError(null);
    setSaved(null);
    setNegativeNote(null);
    const result = await apiJson<T>(path, { method: "POST", body });
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      return null;
    }
    await load();
    setBusy(false);
    return result.data;
  }

  async function saveWaste(values: WasteValues): Promise<boolean> {
    const result = await write<OutflowResult>("/api/stock/waste", { ingredientId, ...values });
    if (!result) return false;
    setSaved(t("stock.waste.saved"));
    if (result.negative) {
      const location = lots?.locations.find(
        (entry) => entry.id === result.movements[0]?.locationId,
      );
      setNegativeNote(
        t("stock.waste.negativeNote", {
          location: location?.name ?? "",
          qty: formatStockQty(result.onHandQty, lots?.ingredient.baseUnit ?? "kg"),
        }),
      );
    }
    return true;
  }

  async function saveTransfer(values: TransferValues): Promise<boolean> {
    const result = await write<TransferResult>("/api/stock/transfers", { ingredientId, ...values });
    if (!result) return false;
    setSaved(t("stock.transfer.saved"));
    return true;
  }

  async function reverse(operation: StockOperation) {
    const result = await write<ReverseResult>(
      `/api/stock/movements/${operation.handleId}/reverse`,
      {},
    );
    if (result) setSaved(t("stock.op.reversedDone"));
  }

  if (!lots || !history) {
    return (
      <>
        <ErrorAlert message={message ?? error} />
        {!message && !error && <Muted>{t("common.loading")}</Muted>}
        <BackLink />
      </>
    );
  }

  const unit = lots.ingredient.baseUnit;
  const unlotted = item?.locations.filter((location) => location.unlottedQty !== 0) ?? [];
  return (
    <>
      <Heading>{lots.ingredient.name}</Heading>
      <Card className="py-1">
        <dl className={DETAIL_LIST_CLASS}>
          <dt className="pr-4 text-ink-muted">{t("stock.onHand")}</dt>
          <dd data-testid="fact-on-hand" className="num font-bold">
            {formatStockQty(item?.onHandQty ?? 0, unit)}
          </dd>
          {item?.locations.map((location) => (
            <FactRow
              key={location.locationId}
              label={location.name}
              value={formatStockQty(location.onHandQty, unit)}
            />
          ))}
          {unlotted.map((location) => (
            <FactRow
              key={`${location.locationId}-unlotted`}
              label={`${t("stock.noLot")} · ${location.name}`}
              value={formatStockQty(location.unlottedQty, unit)}
            />
          ))}
        </dl>
      </Card>

      <SubHeading>{t("stock.lots.title")}</SubHeading>
      {lots.lots.length === 0 ? (
        <Muted>{t("stock.lots.empty")}</Muted>
      ) : (
        <LedgerList>
          {lots.lots.map((lot) => (
            <LotRow key={`${lot.locationId}-${lot.rawLotId ?? "none"}`} lot={lot} unit={unit} />
          ))}
        </LedgerList>
      )}

      <ErrorAlert message={error} />
      {saved && <SuccessNote role="status">{saved}</SuccessNote>}
      {negativeNote && (
        <p role="status" className={warningNoteClass}>
          {negativeNote}
        </p>
      )}
      <WasteForm
        units={lots.units}
        locations={lots.locations}
        lots={lots.lots}
        unit={unit}
        busy={busy}
        onSubmit={saveWaste}
      />
      <TransferForm
        units={lots.units}
        locations={lots.locations}
        lots={lots.lots}
        unit={unit}
        busy={busy}
        onSubmit={saveTransfer}
      />

      <SubHeading>{t("stock.history.title")}</SubHeading>
      {history.operations.length === 0 ? (
        <Muted>{t("stock.history.empty")}</Muted>
      ) : (
        <LedgerList>
          {history.operations.map((operation) => (
            <OperationRow
              key={operation.operationId}
              operation={operation}
              busy={busy}
              onReverse={reverse}
            />
          ))}
        </LedgerList>
      )}
      {history.nextCursor && (
        <div>
          <Button variant="secondary" disabled={busy} onClick={showMore}>
            {t("stock.history.more")}
          </Button>
        </div>
      )}
      <BackLink />
    </>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="pr-4 text-ink-muted">{label}</dt>
      <dd className="num">{value}</dd>
    </>
  );
}

function BackLink() {
  return (
    <Link href="/magazzino" className={`${linkClass} self-start`}>
      ← {t("stock.title")}
    </Link>
  );
}
