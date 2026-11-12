// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CloseSheet } from "@/app/(owner)/tavoli/comanda/close-sheet";
import { BillSheet } from "@/app/(owner)/tavoli/comanda/bill-sheet";
import { LineEditor } from "@/app/(owner)/tavoli/comanda/line-editor";
import { LineRow } from "@/app/(owner)/tavoli/comanda/line-row";
import { MenuSection } from "@/app/(owner)/tavoli/comanda/menu-section";
import { PinnedStrip } from "@/app/(owner)/tavoli/comanda/pinned-strip";
import { SplitPanel } from "@/app/(owner)/tavoli/comanda/split-panel";
import { KitchenLine } from "@/app/(owner)/cucina/kitchen-line";
import { MenuItemCard } from "@/app/(owner)/menu/menu-item-card";
import { ItemsPanel } from "@/app/(owner)/report/items-panel";
import { PlateRow } from "@/app/(owner)/costi/plate-row";
import { PushRow } from "@/app/(owner)/spingere/push-row";
import { PushSheet } from "@/app/(owner)/spingere/push-sheet";
import { PlateBreakdownView } from "@/components/cost/plate-breakdown";
import { EMPTY_CLOSE_FORM } from "@/lib/bill/close-form";
import { initialSplitForm } from "@/lib/bill/split-form";
import { registry } from "@/server/exports/registry";
import type { BillLine, BillOutput } from "@/server/bill/output";
import type { KitchenLine as KitchenLineData } from "@/server/kitchen/output";
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import type { OrderLine } from "@/server/orders/output";
import type { OwnerPlateBreakdown } from "@/server/costing/plate-breakdown";
import type { PlateCost } from "@/server/costing/types";
import { BILL } from "../helpers/bill-data";
import { PLATE } from "../components/cost-fixtures";
import { ITEMS_ADMIN } from "../helpers/report-data";
import { PUSH_LIST_OWNER } from "../helpers/push-data";
import { LINE_STEAK } from "../helpers/orders-data";
import { WEIGHTED_ITEM } from "../helpers/menu-tables-data";
import { KITCHEN_TICKETS } from "../helpers/kitchen-data";
import { STEAK_ITEM } from "../helpers/order-components";

// P2-0b, plan D-11 and step B11. A weighted line stores its line total in `unit_price` with `qty = 1`, so every surface that shows a
// "unit price" must show the price per 100 g and the weight, and the total only as the line's amount. One weighted fixture is
// rendered through every surface of the plan's table: a line of 1 200 g at 9,00 € per 100 g whose total is 108,00 €. The prices
// are invented (the plan's live-menu cases are a source, not facts). Text is compared with the no-break spaces of Intl made plain.

const PER_ETTO = "9,00 € / 100 g";
const WEIGHT = "1,2 kg";
const WRONG_AS_UNIT_PRICE = /1 × 108,00|1× 108,00|108,00 € cad|108,00 € \/ /;

const LINE: OrderLine = {
  ...LINE_STEAK,
  qty: 1,
  weightG: 1200,
  pricePer100g: 9,
  unitPrice: 108,
};
const MENU_ITEM: ServiceMenuItem = { ...STEAK_ITEM, price: 9 };
const MENU_ITEM_PUSHED: ServiceMenuItem = { ...MENU_ITEM, pushed: true, pushPrice: 8 };
const MENU: ServiceMenu = {
  weightMaxG: 3000,
  pinned: [MENU_ITEM_PUSHED],
  categories: [{ name: "Secondi", items: [MENU_ITEM_PUSHED] }],
};
const BILL_LINE: BillLine = {
  id: LINE.id,
  name: LINE.name,
  course: "secondi",
  qty: 1,
  unitPrice: 108,
  amount: 108,
  state: "fired",
  isShared: false,
  weightG: 1200,
  pricePer100g: 9,
};
const BILL_WEIGHTED: BillOutput = { ...BILL, lines: [BILL_LINE], total: 108 };
const KITCHEN_LINE: KitchenLineData = {
  ...KITCHEN_TICKETS.tickets[0]!.lines[0]!,
  name: LINE.name,
  qty: 1,
  weightG: 1200,
  note: null,
};
const MENU_CARD_ITEM = { ...WEIGHTED_ITEM, price: 9, portionWeightG: 400, pushPrice: 8 };
const PLATE_WEIGHTED: PlateCost = {
  ...PLATE,
  priceUnit: "etto",
  pricePer100g: 9,
  portionWeightG: 400,
  salePriceEur: 36,
};
const BREAKDOWN_WEIGHTED: OwnerPlateBreakdown = {
  recipeKey: PLATE.recipeKey,
  name: "Bistecca (demo)",
  version: 1,
  at: null,
  status: "ok",
  incomplete: false,
  reasons: [],
  missingIngredients: [],
  foodCostPct: 18.8528,
  gpPct: 81.1472,
  targetGpPct: 70,
  lines: [
    {
      position: 1,
      target: {
        kind: "ingredient",
        id: "1a000000-0000-4000-8000-000000000001",
        name: "Manzo (demo)",
      },
      sharePct: 100,
      incomplete: false,
      reason: null,
      lineCostEur: 2.0567,
    },
  ],
  money: {
    foodCostEur: 2.0567,
    salePriceEur: 36,
    salePriceExVatEur: 32.7273,
    grossMarginEur: 30.6706,
    priceUnit: "etto",
    pricePer100g: 9,
    portionWeightG: 400,
  },
};
const PUSH_ROW = {
  ...PUSH_LIST_OWNER.rows[1]!,
  plates: PUSH_LIST_OWNER.rows[1]!.plates.map((p) => ({
    ...p,
    pushed: true,
    pushUntil: "2026-11-05T01:00:00Z",
    pushPrice: 8 as number | null,
  })),
};
const noop = () => undefined;

interface Surface {
  name: string;
  element: () => ReactElement;
  /** Shows a unit price, so it must say the price per 100 g. */
  perEtto?: string;
  /** Shows a weighted line, so it must say its weight. */
  weight?: boolean;
  /** Shows no price at all (the kitchen). */
  noEuro?: boolean;
}

const SURFACES: Surface[] = [
  {
    name: "comanda line row",
    element: () =>
      createElement(
        "ul",
        null,
        createElement(LineRow, { line: LINE, editing: false, onEdit: noop }),
      ),
    perEtto: PER_ETTO,
    weight: true,
  },
  {
    name: "comanda line editor",
    element: () =>
      createElement(LineEditor, {
        line: LINE,
        busy: false,
        weight: { maxG: 3000, portionG: 400 },
        onChange: noop,
        onRemove: noop,
        onDone: noop,
      }),
    perEtto: PER_ETTO,
    weight: true,
  },
  {
    name: "offline outbox list (a queued line)",
    element: () =>
      createElement(
        "ul",
        null,
        createElement(LineRow, {
          line: { ...LINE, unitPrice: 0, queue: "add", queuedOpIds: ["op"], queuedAddOpId: "op" },
          editing: false,
          onEdit: noop,
          onDiscard: noop,
        }),
      ),
    perEtto: PER_ETTO,
    weight: true,
  },
  {
    name: "menu tile (in its section)",
    element: () => createElement(MenuSection, { course: "secondi", menu: MENU, onAdd: noop }),
    perEtto: "8,00 € / 100 g",
  },
  {
    name: "pinned strip",
    element: () =>
      createElement(PinnedStrip, { items: [MENU_ITEM, MENU_ITEM_PUSHED], onAdd: noop }),
    perEtto: PER_ETTO,
  },
  {
    name: "menu settings card",
    element: () => createElement(MenuItemCard, { item: MENU_CARD_ITEM, onEdit: noop }),
    perEtto: PER_ETTO,
  },
  {
    name: "push sheet",
    element: () =>
      createElement(PushSheet, {
        plateName: "Bistecca a peso (demo)",
        menuPrice: 9,
        perEtto: true,
        busy: false,
        error: null,
        onConfirm: noop,
        onCancel: noop,
      }),
    perEtto: PER_ETTO,
  },
  {
    name: "push list row (a pushed plate)",
    element: () =>
      createElement(
        "ul",
        null,
        createElement(PushRow, {
          row: PUSH_ROW,
          role: "owner",
          busy: false,
          onPush: noop,
          onStop: noop,
          perEtto: new Set(PUSH_ROW.plates.map((p) => p.menuItemId)),
        }),
      ),
    perEtto: "8,00 € / 100 g",
  },
  {
    name: "bill sheet",
    element: () =>
      createElement(BillSheet, { bill: BILL_WEIGHTED, onBack: noop, onClose: noop, onSplit: noop }),
    perEtto: PER_ETTO,
    weight: true,
  },
  {
    name: "split panel (lines to assign)",
    element: () =>
      createElement(SplitPanel, {
        mode: "items",
        onMode: noop,
        lines: [BILL_LINE],
        covers: 2,
        parts: 2,
        onParts: noop,
        split: null,
        form: initialSplitForm(2),
        onForm: noop,
        onCalculate: noop,
        busy: false,
        error: null,
      }),
    perEtto: PER_ETTO,
    weight: true,
  },
  {
    name: "close sheet (the total only)",
    element: () =>
      createElement(CloseSheet, {
        total: 108,
        form: EMPTY_CLOSE_FORM,
        onForm: noop,
        block: null,
        queuedCount: 0,
        busy: false,
        error: null,
        onSubmit: noop,
        onCancel: noop,
      }),
  },
  {
    name: "kitchen line",
    element: () =>
      createElement(
        "ul",
        null,
        createElement(KitchenLine, {
          line: KITCHEN_LINE,
          pending: false,
          blocked: false,
          onTap: noop,
        }),
      ),
    weight: true,
    noEuro: true,
  },
  {
    name: "items report row",
    element: () =>
      createElement(ItemsPanel, {
        items: {
          ...ITEMS_ADMIN,
          rows: ITEMS_ADMIN.rows.map((row, index) =>
            index === 0 ? { ...row, plates: 1, weightG: 1200, avgWeightG: 1200 } : row,
          ),
        },
      }),
    weight: true,
  },
  {
    name: "plate costs row",
    element: () => createElement("ul", null, createElement(PlateRow, { plate: PLATE_WEIGHTED })),
    perEtto: "Porzione di riferimento 400 g a 9,00 € / 100 g = 36,00 €",
  },
  {
    name: "plate breakdown (owner)",
    element: () =>
      createElement(PlateBreakdownView, { breakdown: BREAKDOWN_WEIGHTED, showMoney: true }),
    perEtto: "Porzione di riferimento 400 g a 9,00 € / 100 g = 36,00 €",
  },
];

afterEach(cleanup);
const plain = (text: string | null) => (text ?? "").replaceAll(" ", " ");

describe.each(SURFACES)("surface: $name", (surface) => {
  it("shows the price per 100 g and the weight, and never the line total as a unit price", () => {
    const { container } = render(surface.element());
    const text = plain(container.textContent);
    if (surface.perEtto) expect(text).toContain(surface.perEtto);
    if (surface.weight) expect(text).toContain(WEIGHT);
    expect(text).not.toMatch(WRONG_AS_UNIT_PRICE);
    expect(text).not.toMatch(/cad\./);
    if (surface.noEuro) expect(text).not.toContain("€");
  });
});

describe("exports", () => {
  const FORBIDDEN_HEADER = /^(prezzo_unitario|unit_price|prezzo_per.*)$/;

  it.each(Object.entries(registry))("%s: no unit-price column for either role", (_slug, table) => {
    for (const role of ["owner", "admin"] as const) {
      const headers = table.columns(role).map((column) => column.header);
      expect(headers.filter((header) => FORBIDDEN_HEADER.test(header))).toEqual([]);
    }
  });

  it("items.csv has the two weight columns after its base columns, in both roles", () => {
    for (const role of ["owner", "admin"] as const) {
      const headers = registry.items.columns(role).map((column) => column.header);
      expect(headers).toContain("peso_venduto_g");
      expect(headers).toContain("peso_medio_g");
      expect(headers.indexOf("peso_medio_g")).toBe(headers.indexOf("peso_venduto_g") + 1);
    }
  });

  it("unmapped.csv has no weight column (plates and gross only)", () => {
    const headers = registry["unmapped-items"].columns("owner").map((column) => column.header);
    expect(headers.filter((header) => /peso|weight/i.test(header))).toEqual([]);
  });
});
