import { describe, expect, it } from "vitest";
import {
  conflictMessage,
  courseCounts,
  courseLabel,
  groupLinesByCourse,
  hintFor,
  itemsForCourse,
  lineLabel,
  sheetSummary,
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
