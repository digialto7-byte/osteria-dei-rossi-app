import { describe, expect, it } from "vitest";
import {
  conflictMessage,
  courseCounts,
  courseLabel,
  groupLinesByCourse,
  hintFor,
  itemsForCourse,
  lineLabel,
  applyItemStock,
  pendingLine,
  removeLineById,
  upsertLine,
  withPending,
  qtyText,
  sheetSummary,
  shownPrice,
  tabLabel,
  unavailableMessage,
} from "@/lib/orders/order-view";
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import type { OrderLine } from "@/server/orders/output";
import { LINE_SOUP, LINE_STEW, OIDS } from "../../helpers/orders-data";

const item = (
  id: string,
  name: string,
  course: ServiceMenuItem["course"],
  category: string,
): ServiceMenuItem => ({
  id,
  name,
  category,
  course,
  price: 5,
  available: true,
  unavailableReason: null,
  portionsLeft: null,
  lowStock: false,
  pushed: false,
  pushPrice: null,
});
const BRUSCHETTA = item("b1", "Bruschetta (demo)", "antipasti", "Antipasti");
const SOUP = item("s1", "Zuppa del giorno (demo)", "primi", "Primi");
const PASTA = item("p1", "Tagliatelle al ragù (demo)", "primi", "Primi");
const STEW = item("t1", "Spezzatino con polenta (demo)", "secondi", "Secondi");
const WATER = item("w1", "Acqua (demo)", "bevande", "Bevande");
// A "primi" dish filed under the category "Secondi": the tab follows the course field, not the category.
const SIDE = item("x1", "Pasta al forno (demo)", "primi", "Secondi");

const MENU: ServiceMenu = {
  pinned: [],
  categories: [
    { name: "Antipasti", items: [BRUSCHETTA] },
    { name: "Primi", items: [SOUP, PASTA] },
    { name: "Secondi", items: [STEW, SIDE] },
    { name: "Bevande", items: [WATER] },
  ],
};

const ids = (items: ServiceMenuItem[]) => items.map((i) => i.id);

describe("itemsForCourse", () => {
  it("puts the tab's course first, grouped by category in API order, and the rest apart", () => {
    const { groups, others } = itemsForCourse(MENU, "primi");
    expect(groups.map((g) => g.name)).toEqual(["Primi", "Secondi"]);
    expect(ids(groups[0]!.items)).toEqual(["s1", "p1"]);
    expect(ids(groups[1]!.items)).toEqual(["x1"]);
    expect(ids(others).sort()).toEqual(["b1", "t1", "w1"]);
  });

  it("matches by the course field, never by the category name", () => {
    const { groups } = itemsForCourse(MENU, "secondi");
    expect(groups.flatMap((g) => ids(g.items))).toEqual(["t1"]);
  });

  it("a course with no dish has no group and everything is 'other'", () => {
    const { groups, others } = itemsForCourse(MENU, "dolci");
    expect(groups).toEqual([]);
    expect(others).toHaveLength(6);
  });

  it("an empty menu is empty", () => {
    expect(itemsForCourse({ pinned: [], categories: [] }, "primi")).toEqual({
      groups: [],
      others: [],
    });
  });
});

describe("hintFor", () => {
  it("says how many are left when the database says lowStock", () => {
    expect(hintFor({ lowStock: true, portionsLeft: 3 })).toBe("Ne restano 3");
    expect(hintFor({ lowStock: true, portionsLeft: 2.5 })).toBe("Ne restano 2,5");
    expect(hintFor({ lowStock: true, portionsLeft: 1 })).toBe("Ne resta 1");
    expect(hintFor({ lowStock: true, portionsLeft: 0.5 })).toBe("Ne restano 0,5");
  });

  it("is null when lowStock is false, whatever the number", () => {
    expect(hintFor({ lowStock: false, portionsLeft: 3 })).toBeNull();
    expect(hintFor({ lowStock: false, portionsLeft: null })).toBeNull();
  });

  it("is null for lowStock without a number (nothing to say)", () => {
    expect(hintFor({ lowStock: true, portionsLeft: null })).toBeNull();
  });
});

describe("lineLabel", () => {
  it("writes 'qty × name', 'half' for 0.5", () => {
    expect(lineLabel(2, "Spezzatino con polenta (demo)")).toBe("2 × Spezzatino con polenta (demo)");
    expect(lineLabel(1, "Acqua (demo)")).toBe("1 × Acqua (demo)");
    expect(lineLabel(1.5, "Acqua (demo)")).toBe("1,5 × Acqua (demo)");
    expect(lineLabel(0.5, "Zuppa del giorno (demo)")).toBe("½ Zuppa del giorno (demo)");
  });
});

describe("conflictMessage", () => {
  it("names the colleague and the Europe/Rome time", () => {
    const line: OrderLine = {
      ...LINE_STEW,
      updatedAt: "2026-11-02T19:31:00Z",
      updatedBy: { id: OIDS.waiterB, displayName: "Cameriere Due Demo" },
    };
    expect(conflictMessage("stale", line)).toBe(
      "Questa riga è stata cambiata da Cameriere Due Demo alle 20:31: ecco la versione attuale.",
    );
  });

  it("uses summer time too (Europe/Rome is UTC+2 in July)", () => {
    const line = { ...LINE_STEW, updatedAt: "2026-07-02T19:31:00+00:00" };
    expect(conflictMessage("stale", line)).toContain("alle 21:31");
  });

  it("has its own words for fired, voided and closed", () => {
    expect(conflictMessage("fired", LINE_STEW)).toBe("Questa riga è già stata inviata in cucina.");
    expect(conflictMessage("voided", LINE_STEW)).toBe("Questa riga è stata tolta.");
    expect(conflictMessage("session_closed", LINE_STEW)).toBe("Il tavolo è stato chiuso.");
  });
});

describe("unavailableMessage", () => {
  it("names the dish", () => {
    expect(unavailableMessage("Spezzatino con polenta (demo)")).toBe(
      "Spezzatino con polenta (demo) è esaurito.",
    );
  });
});

describe("courses", () => {
  const lines: OrderLine[] = [
    LINE_STEW,
    { ...LINE_STEW, id: "l3", course: "primi" },
    LINE_SOUP,
    { ...LINE_STEW, id: "l4", course: "dolci", state: "voided" },
  ];

  it("courseCounts counts lines that are not voided, for every course", () => {
    expect(courseCounts(lines)).toEqual({
      antipasti: 0,
      primi: 2,
      secondi: 1,
      dolci: 0,
      bevande: 0,
    });
  });

  it("tabLabel shows the count only when there is one", () => {
    expect(tabLabel("primi", 2)).toBe("Primi · 2");
    expect(tabLabel("dolci", 0)).toBe("Dolci");
    expect(courseLabel("bevande")).toBe("Bevande");
  });

  it("groupLinesByCourse keeps the service order, skips empty courses and voided lines", () => {
    const groups = groupLinesByCourse(lines);
    expect(groups.map((g) => g.course)).toEqual(["primi", "secondi"]);
    expect(groups[0]!.lines.map((l) => l.id)).toEqual(["l3", OIDS.line2]);
  });

  it("sheetSummary counts the rows", () => {
    expect(sheetSummary(lines)).toBe("Comanda · 3 righe");
    expect(sheetSummary([LINE_STEW])).toBe("Comanda · 1 riga");
    expect(sheetSummary([])).toBe("Comanda");
  });
});

describe("shownPrice", () => {
  it("is the push price while the item is pushed, else the menu price", () => {
    expect(shownPrice({ ...STEW, price: 14, pushed: true, pushPrice: 12 })).toBe(12);
    expect(shownPrice({ ...STEW, price: 14, pushed: false, pushPrice: null })).toBe(14);
    expect(shownPrice({ ...STEW, price: 14, pushed: true, pushPrice: null })).toBe(14);
  });
});

describe("pendingLine", () => {
  it("is a draft line of one portion with the shown price, ready to be replaced by the server's", () => {
    const line = pendingLine(
      { ...STEW, pushed: true, pushPrice: 12 },
      "primi",
      "L1",
      "2026-11-02T19:30:00.000Z",
    );
    expect(line).toMatchObject({
      id: "L1",
      menuItemId: STEW.id,
      name: STEW.name,
      course: "primi",
      qty: 1,
      state: "draft",
      unitPrice: 12,
      note: null,
      segue: false,
      isShared: false,
      clientUpdatedAt: "2026-11-02T19:30:00.000Z",
    });
  });
});

describe("qtyText", () => {
  it("writes whole numbers, decimals with a comma and a half as ½", () => {
    expect(qtyText(2)).toBe("2");
    expect(qtyText(1.5)).toBe("1,5");
    expect(qtyText(0.5)).toBe("½");
  });
});

describe("line list helpers", () => {
  const A: OrderLine = { ...LINE_STEW, id: "a" };
  const B: OrderLine = { ...LINE_SOUP, id: "b" };

  it("upsertLine replaces a line by id and keeps its place", () => {
    const changed = { ...A, qty: 5 };
    expect(upsertLine([A, B], changed)).toEqual([changed, B]);
  });

  it("upsertLine appends a line it has not seen", () => {
    expect(upsertLine([A], B)).toEqual([A, B]);
  });

  it("removeLineById drops one line and no other", () => {
    expect(removeLineById([A, B], "a")).toEqual([B]);
    expect(removeLineById([A, B], "zz")).toEqual([A, B]);
  });

  it("withPending shows the lines in flight after the server's, unless the server already has them", () => {
    const flying = { ...A, id: "p1" };
    expect(withPending([A, B], [flying])).toEqual([A, B, flying]);
    expect(withPending([A, B], [{ ...A, id: "b" }])).toEqual([A, B]);
    expect(withPending([A], [])).toEqual([A]);
  });
});

describe("applyItemStock", () => {
  it("updates the dish in its category and in the pinned list, by id, and nothing else", () => {
    const menu: ServiceMenu = {
      pinned: [{ ...STEW, pushed: true, pushPrice: 12 }],
      categories: [
        { name: "Secondi", items: [STEW, { ...STEW, id: "other", name: "Altro (demo)" }] },
      ],
    };
    const next = applyItemStock(menu, {
      id: STEW.id,
      available: true,
      portionsLeft: 2,
      lowStock: true,
    });
    expect(next.categories[0]!.items.find((i) => i.id === STEW.id)).toMatchObject({
      portionsLeft: 2,
      lowStock: true,
    });
    expect(next.pinned[0]).toMatchObject({ portionsLeft: 2, lowStock: true, pushPrice: 12 });
    expect(next.categories[0]!.items.find((i) => i.id === "other")).toEqual({
      ...STEW,
      id: "other",
      name: "Altro (demo)",
    });
    expect(menu.categories[0]!.items[0]).toEqual(STEW);
  });

  it("a dish that is no longer available gets a reason from the reply's numbers", () => {
    const menu: ServiceMenu = { pinned: [], categories: [{ name: "Secondi", items: [STEW] }] };
    const next = applyItemStock(menu, {
      id: STEW.id,
      available: false,
      portionsLeft: 0,
      lowStock: false,
    });
    expect(next.categories[0]!.items[0]).toMatchObject({
      available: false,
      unavailableReason: "no_portions",
      portionsLeft: 0,
    });
  });
});
