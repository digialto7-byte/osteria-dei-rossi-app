import { expect } from "vitest";
import type { ExportRole } from "@/server/exports/types";

// AT1, independent of the code under test (M24 review fix). Nothing here imports the registry, its columns or the CSV writer: every table has
// its own expected map, header -> where the value lives in the JSON (or how it is derived), and every cell of the file is compared with that
// JSON value written by a rule re-stated below (decimal comma, empty for null, dates GG/MM/AAAA, instants in Europe/Rome through a small Intl call,
// sì/no, one leading apostrophe on a text that starts with = + - @ tab CR or their full-width forms).

type Json = Record<string, unknown>;
type Row = Json;
type Fmt = (value: unknown) => string;

export const pick = (json: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (o, k) => (o === null || o === undefined ? null : (o as Record<string, unknown>)[k]),
    json,
  );

const num: Fmt = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
const text: Fmt = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /^[=+\-@\t\r＝＋－＠]/.test(s) ? `'${s}` : s;
};
const date: Fmt = (v) => {
  if (v === null || v === undefined) return "";
  const [y, m, d] = String(v).split("-");
  return `${d}/${m}/${y}`;
};
const bool: Fmt = (v) => (v === null || v === undefined ? "" : v ? "sì" : "no");
const romeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const rome: Fmt = (v) => {
  if (v === null || v === undefined) return "";
  const p = Object.fromEntries(
    romeParts.formatToParts(new Date(String(v))).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
};
const names = (list: unknown) => (list as { name: string }[]).map((x) => x.name).join(" | ");

/** [header, expected cell of a row]. */
type Col = [string, (row: Row, json: Json) => string];
const f = (header: string, fmt: Fmt, ...path: string[]): Col => [
  header,
  (row) => fmt(pick(row, ...path)),
];

interface Spec {
  rows: (json: Json) => Row[];
  cols: (role: ExportRole) => Col[];
}

// kpis.csv: the 23 figures (JSON path in a KPI block, delta key), then 24 hours and 7 weekdays.
const KPI_FIGURES: [string, string[], string | null][] = [
  ["daysFinal", ["daysFinal"], null],
  ["days", ["days"], null],
  ["covers", ["covers"], "covers"],
  ["tables", ["tables"], "tables"],
  ["revenueGrossEur", ["revenueGrossEur"], "revenueGrossEur"],
  ["revenueNetEur", ["revenueNetEur"], "revenueNetEur"],
  ["copertoNetEur", ["copertoNetEur"], null],
  ["avgSpendPerCoverEur", ["avgSpendPerCoverEur"], "avgSpendPerCoverEur"],
  ["avgTicketEur", ["avgTicketEur"], "avgTicketEur"],
  ["plates", ["plates"], "plates"],
  ["foodCostEur", ["foodCostEur"], "foodCostEur"],
  ["foodCostPct", ["foodCostPct"], "foodCostPct"],
  ["costedRevenueNetEur", ["costedRevenueNetEur"], null],
  ["uncostedRevenueNetEur", ["uncostedRevenueNetEur"], null],
  ["costedSharePct", ["costedSharePct"], null],
  ["purchasesEur", ["purchasesEur"], "purchasesEur"],
  ["purchasesUnvaluedCount", ["purchasesUnvaluedCount"], null],
  ["wasteEur", ["waste", "valueEur"], "wasteEur"],
  ["wasteUnvaluedCount", ["waste", "unvaluedCount"], null],
  ["appTotalEur", ["appVsRegister", "appTotalEur"], "appTotalEur"],
  ["registerTotalEur", ["appVsRegister", "registerTotalEur"], null],
  ["appVsRegisterDiffEur", ["appVsRegister", "difference", "amount"], null],
  ["appVsRegisterDiffPct", ["appVsRegister", "difference", "pct"], null],
];

const kpiRows = (json: Json): Row[] => {
  const rows: Row[] = KPI_FIGURES.map(([key, path, delta]) => ({
    key,
    cur: pick(json, "current", ...path),
    prev: pick(json, "previous", ...path),
    abs: delta === null ? null : pick(json, "delta", delta, "abs"),
    pct: delta === null ? null : pick(json, "delta", delta, "pct"),
  }));
  for (let h = 0; h < 24; h += 1) {
    rows.push({
      key: `coversByHour.${String(h).padStart(2, "0")}`,
      cur: (pick(json, "current", "coversByHour") as number[])[h],
      prev: (pick(json, "previous", "coversByHour") as number[])[h],
      abs: null,
      pct: null,
    });
  }
  for (let d = 0; d < 7; d += 1) {
    rows.push({
      key: `coversByWeekday.${d + 1}`,
      cur: (pick(json, "current", "coversByWeekday") as number[])[d],
      prev: (pick(json, "previous", "coversByWeekday") as number[])[d],
      abs: null,
      pct: null,
    });
  }
  return rows;
};

const itemBase: Col[] = [
  f("menu_item_id", text, "menuItemId"),
  f("piatto", text, "name"),
  f("portata", text, "course"),
  f("piatti", num, "plates"),
  f("mix_pct", num, "mixPct"),
  f("ricavi_netti_eur", num, "revenueNetEur"),
  f("piatti_con_costo", num, "costedPlates"),
  f("ricavi_netti_con_costo_eur", num, "costedRevenueNetEur"),
  f("food_cost_eur", num, "foodCostEur"),
  f("food_cost_pct", num, "foodCostPct"),
  f("margine_cibo_per_piatto_eur", num, "foodMarginPerPlateEur"),
  f("stato", text, "status"),
  f("peso_venduto_g", num, "weightG"),
  f("peso_medio_g", num, "avgWeightG"),
];

const ownerItems: Col[] = [
  f("costo_fisso_per_piatto_eur", num, "fixedCostPerPlateEur"),
  f("margine_lordo_per_piatto_eur", num, "grossMarginPerPlateEur"),
  f("contributo_eur", num, "contributionEur"),
  f("motivo_costo_fisso", text, "fixedCostReason"),
];

// services.csv (M25c): one row per service in the reply's order, then the total row (empty key, "Totale"). The name column is the service's name.
const serviceBlock: Col[] = [
  f("coperti", num, "covers"),
  f("tavoli", num, "tables"),
  f("incasso_lordo_eur", num, "revenueGrossEur"),
  f("incasso_netto_eur", num, "revenueNetEur"),
  f("spesa_media_coperto_eur", num, "avgSpendPerCoverEur"),
  f("scontrino_medio_eur", num, "avgTicketEur"),
  f("piatti", num, "plates"),
  f("food_cost_eur", num, "foodCostEur"),
  f("food_cost_pct", num, "foodCostPct"),
  f("quota_incasso_pct", num, "revenueSharePct"),
];

const SPECS: Record<string, Spec> = {
  services: {
    rows: (json) => [
      ...(json.services as Row[]),
      { ...(json.total as Row), key: null, name: "Totale" },
    ],
    cols: () => [f("chiave", text, "key"), f("servizio", text, "name"), ...serviceBlock],
  },
  kpis: {
    rows: kpiRows,
    cols: () => [
      f("chiave", text, "key"),
      // `voce` is an Italian label, not a JSON value: it only has to be there.
      ["voce", (row) => (row.key ? "*" : "")],
      f("valore", num, "cur"),
      f("valore_precedente", num, "prev"),
      f("differenza", num, "abs"),
      f("differenza_pct", num, "pct"),
    ],
  },
  items: {
    rows: (json) => json.rows as Row[],
    cols: (role) => (role === "owner" ? [...itemBase, ...ownerItems] : itemBase),
  },
  avt: {
    rows: (json) => json.rows as Row[],
    cols: () => [
      f("ingredient_id", text, "ingredientId"),
      f("ingrediente", text, "name"),
      f("unita", text, "baseUnit"),
      f("consumo_reale", num, "actualQty"),
      f("consumo_teorico", num, "theoreticalQty"),
      f("scarti", num, "wasteQty"),
      f("scostamento", num, "varianceQty"),
      f("costo_unitario_eur", num, "unitCostEur"),
      f("scostamento_eur", num, "varianceEur"),
    ],
  },
  "unmapped-items": {
    rows: (json) => json.rows as Row[],
    cols: () => [
      f("menu_item_id", text, "menuItemId"),
      f("piatto", text, "name"),
      f("piatti", num, "plates"),
      f("ricavi_lordi_eur", num, "revenueGrossEur"),
      f("ultima_vendita", date, "lastSoldOn"),
    ],
  },
  "discards-vs-push": {
    rows: (json) => json.rows as Row[],
    cols: () => [
      f("recipe_key", text, "recipeKey"),
      f("preparazione", text, "name"),
      f("durata_ore", num, "shelfLifeHours"),
      f("lotti_scartati", num, "batchesDiscarded"),
      f("lotti_in_evidenza", num, "batchesPushed"),
      f("porzioni_scartate", num, "portionsDiscarded"),
      f("porzioni_in_evidenza", num, "portionsPushed"),
      f("valore_eur", num, "valueEur"),
      f("senza_costo", num, "unvaluedCount"),
    ],
  },
  "push-list": {
    rows: (json) => json.rows as Row[],
    cols: () => [
      f("tipo", text, "kind"),
      f("id", text, "id"),
      f("nome", text, "name"),
      f("lotto", text, "lotCode"),
      f("prodotto_il", date, "madeOn"),
      f("consumare_entro", rome, "useByAt"),
      f("scadenza", date, "expiryDate"),
      f("ore_rimaste", num, "hoursToUseBy"),
      f("quantita", num, "quantity"),
      f("unita", text, "unit"),
      f("costo_a_rischio_eur", num, "costAtRiskEur"),
      ["piatti", (row) => text(names(row.plates))],
      [
        "piatti_in_evidenza",
        (row) =>
          text(names((row.plates as { name: string; pushed: boolean }[]).filter((p) => p.pushed))),
      ],
      ["preparazioni", (row) => text(names(row.batchRecipes))],
    ],
  },
  forecast: {
    rows: (json) => json.batches as Row[],
    cols: () => [
      f("recipe_key", text, "recipeKey"),
      f("preparazione", text, "name"),
      ["data", (_row, json) => date(json.date)],
      f("porzioni_attese", num, "expectedPortions"),
      f("porzioni_disponibili", num, "onHandPortions"),
      f("mancanti", num, "gap"),
    ],
  },
  "forecast-plates": {
    rows: (json) => json.plates as Row[],
    cols: () => [
      f("menu_item_id", text, "menuItemId"),
      f("piatto", text, "name"),
      ["data", (_row, json) => date(json.date)],
      f("piatti_attesi", num, "expectedPlates"),
    ],
  },
  "waste-costs": {
    rows: (json) =>
      (json.reasons as Json[]).flatMap((reason) => [
        ...(reason.lines as Row[]).map((l) => ({
          motivo: reason.reasonCode,
          tipo: "ingrediente",
          id: l.ingredientId,
          nome: l.ingredientName,
          unita: l.baseUnit,
          quantita: l.qty,
          valore: l.valueEur,
          senza: l.valueEur === null ? 1 : 0,
        })),
        ...(reason.batchLines as Row[]).map((l) => ({
          motivo: reason.reasonCode,
          tipo: "preparazione",
          id: l.recipeKey,
          nome: l.recipeName,
          unita: "porz",
          quantita: l.portions,
          valore: l.valueEur,
          senza: l.unvaluedCount,
        })),
      ]),
    cols: () => [
      f("motivo", text, "motivo"),
      f("tipo", text, "tipo"),
      f("id", text, "id"),
      f("nome", text, "nome"),
      f("unita", text, "unita"),
      f("quantita", num, "quantita"),
      f("valore_eur", num, "valore"),
      f("senza_costo", num, "senza"),
    ],
  },
  "count-variance": {
    rows: (json) => pick(json, "variance", "lines") as Row[],
    cols: () => [
      f("ingredient_id", text, "ingredientId"),
      f("ingrediente", text, "name"),
      f("unita", text, "baseUnit"),
      f("atteso", num, "expectedQty"),
      f("contato", num, "countedQty"),
      f("differenza", num, "differenceQty"),
      f("registrato", num, "postedQty"),
      [
        "valore_eur",
        (row, json) => {
          const line = (pick(json, "costs", "lines") as Row[]).find(
            (l) => l.ingredientId === row.ingredientId,
          );
          return num(line ? line.valueEur : null);
        },
      ],
    ],
  },
  reconciliation: {
    rows: (json) => json.items as Row[],
    cols: () => [
      f("ingredient_id", text, "ingredientId"),
      f("ingrediente", text, "name"),
      f("unita", text, "baseUnit"),
      f("iniziale", num, "openingQty"),
      f("carichi", num, "receiptsQty"),
      f("consumi", num, "consumptionQty"),
      f("scarti", num, "wasteQty"),
      f("trasferimenti_in", num, "transfersInQty"),
      f("trasferimenti_out", num, "transfersOutQty"),
      f("rettifiche_conteggio", num, "countAdjustmentsQty"),
      f("altro", num, "otherQty"),
      f("finale", num, "closingQty"),
      f("quadra", bool, "balanced"),
      f("contato", num, "countedQty"),
      f("contato_il", rome, "countedAt"),
      f("conteggio_id", text, "countSessionId"),
      f("dopo_conteggio", num, "afterCountQty"),
      f("coincide", bool, "matchesCount"),
    ],
  },
};

/** The JSON row count a table must have, from the expected map (not from the registry). */
export function expectedRowCount(slug: string, json: unknown): number {
  return SPECS[slug]!.rows(json as Json).length;
}

/**
 * The CSV, read back as records (header first), equals the JSON the same query gave: the header and the row count, then every cell against the
 * expected map of the table. Returns the number of data rows.
 */
export function expectCsvMatchesJson(
  csv: string[][],
  slug: string,
  role: ExportRole,
  json: unknown,
  label = slug,
): number {
  const spec = SPECS[slug];
  if (!spec) throw new Error(`no expected map for ${slug}`);
  const cols = spec.cols(role);
  expect(csv[0], `${label} header`).toEqual(cols.map(([h]) => h));
  const rows = spec.rows(json as Json);
  expect(csv.length - 1, `${label} rows`).toBe(rows.length);
  rows.forEach((row, r) => {
    cols.forEach(([header, expected], c) => {
      const written = csv[r + 1]![c]!;
      const want = expected(row, json as Json);
      if (header === "voce") return expect(written, `${label} row ${r} voce`).not.toBe("");
      expect(written, `${label} row ${r} ${header}`).toBe(want);
    });
  });
  return rows.length;
}
