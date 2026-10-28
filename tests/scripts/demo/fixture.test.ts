import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isValidItVat } from "@/lib/vat/it-vat";
import { addDays } from "../../../scripts/lib/demo/dates";
import {
  ADMIN_EMAIL,
  buildFixture,
  cents,
  invoiceTotals,
  lineAmount,
  OWNER_LOCAL_EMAIL,
  type DemoFixture,
  type DemoRecipe,
} from "../../../scripts/lib/demo/fixture";
import { demoInvoicePdf } from "../../../scripts/lib/demo/pdf";

const TODAY = "2026-10-24";
const fixture = buildFixture(TODAY);

/** Every string value in the fixture, with the key it sits under. */
function strings(value: unknown, key = ""): { key: string; text: string }[] {
  if (typeof value === "string") return [{ key, text: value }];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => strings(v, k));
  }
  return [];
}

// Words that are not names: identifiers, units, codes, enum-like labels.
const NAME_KEYS = new Set(["name", "label", "description", "display_name"]);

describe("names and privacy", () => {
  it("every name, label and description ends in (demo): the data goes into a real tenant, so it must stand out", () => {
    const named = strings(fixture).filter((s) => NAME_KEYS.has(s.key));
    expect(named.length).toBeGreaterThan(30);
    const bad = named.filter((s) => !s.text.endsWith("(demo)"));
    expect(bad).toEqual([]);
  });

  it("the demo owner and admin addresses are on the reserved example.test domain and nothing else looks like an address", () => {
    expect(OWNER_LOCAL_EMAIL).toMatch(/\.demo@example\.test$/);
    expect(ADMIN_EMAIL).toMatch(/\.demo@example\.test$/);
    expect(ADMIN_EMAIL).not.toBe(OWNER_LOCAL_EMAIL);
    const emails = strings(fixture).filter((s) => s.text.includes("@"));
    expect(emails.map((e) => e.text).sort()).toEqual([ADMIN_EMAIL, OWNER_LOCAL_EMAIL].sort());
    // Not the founder's account, and no tenant name or VAT in the data: the target tenant is a client fact.
    expect(JSON.stringify(fixture)).not.toMatch(/gmail|digialto7/i);
    expect(fixture).not.toHaveProperty("tenant");
  });

  it("nothing matches the client's name", () => {
    expect(JSON.stringify(fixture)).not.toMatch(/rossi/i);
    expect(demoInvoicePdfText()).not.toMatch(/rossi/i);
  });

  it("nothing is taken from docs/client", () => {
    const dir = new URL("../../../docs/client/", import.meta.url);
    if (!existsSync(dir)) return;
    // What a person reads: names, labels, descriptions and categories (keys are internal identifiers).
    const own = strings(fixture)
      .filter((s) => NAME_KEYS.has(s.key) || s.key === "category")
      .map((s) => s.text.toLowerCase())
      .filter((text) => text.length >= 6);
    let compared = 0;
    let hits = 0;
    for (const file of readdirSync(dir)) {
      for (const raw of readFileSync(new URL(file, dir), "utf8").split(/\r?\n|,|\|/)) {
        const line = raw
          .trim()
          .toLowerCase()
          .replace(/\s*\(demo\)$/, "");
        if (line.length < 6) continue;
        compared += 1;
        // A count only: a failing run must not print the draft's content.
        if (own.some((text) => text.replace(/\s*\(demo\)$/, "") === line)) hits += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(hits).toBe(0);
  });

  it("supplier VATs pass the check digit", () => {
    for (const supplier of fixture.suppliers) {
      expect(isValidItVat(supplier.vat)).toBe(true);
    }
    expect(new Set(fixture.suppliers.map((s) => s.vat)).size).toBe(fixture.suppliers.length);
  });
});

describe("two of everything", () => {
  const count = (items: unknown[]) => items.length;
  it("has at least two of each kind that is shown in a list", () => {
    const f = fixture;
    expect(f.staff.filter((s) => s.role === "chef").length).toBeGreaterThanOrEqual(2);
    expect(f.staff.filter((s) => s.role === "waiter").length).toBeGreaterThanOrEqual(2);
    expect(count(f.devices)).toBeGreaterThanOrEqual(2);
    expect(count(f.menu)).toBeGreaterThanOrEqual(2);
    expect(count(f.diningTables)).toBeGreaterThanOrEqual(2);
    expect(count(f.locations)).toBeGreaterThanOrEqual(2);
    expect(count(f.suppliers)).toBeGreaterThanOrEqual(2);
    expect(f.invoices.filter((i) => i.approve).length).toBeGreaterThanOrEqual(2);
    expect(f.recipes.filter((r) => r.type === "batch").length).toBeGreaterThanOrEqual(2);
    expect(f.recipes.filter((r) => r.type === "plate").length).toBeGreaterThanOrEqual(2);
    expect(f.productions.length).toBeGreaterThanOrEqual(2);
    expect(f.ingredients.filter((i) => i.isStock).length).toBeGreaterThanOrEqual(2);
    expect(f.count.counted.length).toBeGreaterThanOrEqual(2);
    expect(f.critical.length).toBeGreaterThanOrEqual(2);
  });

  it("covers every state the screens show: one device revoked, one kept, one invoice in review", () => {
    expect(fixture.devices.filter((d) => d.revoke)).toHaveLength(1);
    expect(fixture.devices.filter((d) => d.kitchen)).toHaveLength(1);
    expect(fixture.devices.find((d) => d.kitchen)?.revoke).toBe(false);
    expect(fixture.invoices.filter((i) => !i.approve)).toHaveLength(1);
    expect(fixture.invoices.filter((i) => i.paid)).toHaveLength(1);
  });

  it("uses unique keys inside each list", () => {
    const lists: Record<string, { key: string }[]> = {
      staff: fixture.staff,
      devices: fixture.devices,
      locations: fixture.locations,
      suppliers: fixture.suppliers,
      ingredients: fixture.ingredients,
      invoices: fixture.invoices,
      recipes: fixture.recipes,
      productions: fixture.productions,
      menu: fixture.menu,
      diningTables: fixture.diningTables,
    };
    for (const [name, items] of Object.entries(lists)) {
      expect({ name, unique: new Set(items.map((i) => i.key)).size }).toEqual({
        name,
        unique: items.length,
      });
    }
    expect(new Set(fixture.invoices.map((i) => i.number)).size).toBe(fixture.invoices.length);
  });

  it("refers only to keys that exist", () => {
    const f = fixture;
    const keys = (items: { key: string }[]) => new Set(items.map((i) => i.key));
    const [ing, loc, sup, rec, prod] = [
      keys(f.ingredients),
      keys(f.locations),
      keys(f.suppliers),
      keys(f.recipes),
      keys(f.productions),
    ];
    for (const i of f.ingredients) if (i.home) expect(loc.has(i.home)).toBe(true);
    for (const inv of f.invoices) {
      expect(sup.has(inv.supplier)).toBe(true);
      expect(loc.has(inv.location)).toBe(true);
      for (const l of inv.lines) expect(ing.has(l.ingredient)).toBe(true);
    }
    for (const r of f.recipes) {
      for (const v of r.versions) {
        for (const l of v.lines) {
          expect(Boolean(l.ingredient) !== Boolean(l.recipe)).toBe(true);
          if (l.ingredient) expect(ing.has(l.ingredient)).toBe(true);
          if (l.recipe) expect(rec.has(l.recipe)).toBe(true);
        }
      }
    }
    for (const p of f.productions) expect(rec.has(p.recipe)).toBe(true);
    // M17: a mapped menu item points at a plate recipe, once.
    const mapped = f.menu.filter((m) => m.recipe).map((m) => m.recipe!);
    for (const key of mapped) expect(f.recipes.find((r) => r.key === key)?.type).toBe("plate");
    expect(new Set(mapped).size).toBe(mapped.length);
    for (const k of f.critical) expect(ing.has(k)).toBe(true);
    for (const t of f.stockOps.transfers) {
      expect([ing.has(t.ingredient), loc.has(t.from), loc.has(t.to)]).toEqual([true, true, true]);
    }
    for (const a of [
      f.batchActions.split.from,
      f.batchActions.discard.from,
      f.batchActions.adjust.from,
    ]) {
      expect(prod.has(a)).toBe(true);
    }
    expect(loc.has(f.count.location)).toBe(true);
    // A sub-recipe never refers to something defined after it, so the seed can create recipes in order.
    const order = f.recipes.map((r) => r.key);
    f.recipes.forEach((r, index) => {
      for (const v of r.versions) {
        for (const l of v.lines) if (l.recipe) expect(order.indexOf(l.recipe)).toBeLessThan(index);
      }
    });
  });
});

function demoInvoicePdfText(): string {
  return Buffer.from(demoInvoicePdf()).toString("latin1");
}

describe("menu and tables (M17)", () => {
  it("has mapped items, one unmapped item, a price and an allowed VAT rate on each", () => {
    expect(fixture.menu.filter((m) => m.recipe).length).toBeGreaterThanOrEqual(2);
    expect(fixture.menu.filter((m) => !m.recipe).length).toBeGreaterThanOrEqual(1);
    for (const item of fixture.menu) {
      expect(item.price).toBeGreaterThan(0);
      expect([0, 4, 5, 10, 22]).toContain(item.vatRate);
      expect(["antipasti", "primi", "secondi", "dolci", "bevande"]).toContain(item.course);
    }
  });

  it("a mapped item sells at its plate's price, so the screens agree", () => {
    for (const item of fixture.menu.filter((m) => m.recipe)) {
      expect(item.price).toBe(fixture.recipes.find((r) => r.key === item.recipe)!.salePrice);
    }
  });

  it("has a coperto in the allowed range with an allowed VAT rate, and no session is opened", () => {
    expect(fixture.coperto.amount).toBeGreaterThan(0);
    expect(fixture.coperto.amount).toBeLessThanOrEqual(100);
    expect([0, 4, 5, 10, 22]).toContain(fixture.coperto.vatRate);
    expect(fixture).not.toHaveProperty("sessions");
  });
});

describe("invoices", () => {
  const byKey = (key: string) => fixture.invoices.find((i) => i.key === key)!;

  it("totals are the sum of the lines, VAT 10 %, to the cent", () => {
    expect(invoiceTotals(byKey("f1"))).toEqual({ net: 127, vat: 12.7, gross: 139.7 });
    expect(invoiceTotals(byKey("f2"))).toEqual({ net: 87.2, vat: 8.72, gross: 95.92 });
    expect(invoiceTotals(byKey("f3"))).toEqual({ net: 44.7, vat: 4.47, gross: 49.17 });
    expect(invoiceTotals(byKey("f4"))).toEqual({ net: 17.1, vat: 1.71, gross: 18.81 });
    expect(invoiceTotals(byKey("f5"))).toEqual({ net: 5.8, vat: 0.58, gross: 6.38 });
    for (const invoice of fixture.invoices) {
      const sum = invoice.lines.reduce((total, l) => total + cents(lineAmount(l)), 0);
      expect(invoiceTotals(invoice).net).toBe(sum / 100);
    }
  });

  it("dates are offsets from today: overdue, due soon, a price rise, one expiring tomorrow", () => {
    expect(byKey("f1").dueOffset).toBeLessThan(0);
    expect(byKey("f3").dueOffset).toBeGreaterThan(0);
    expect(byKey("f3").dueOffset).toBeLessThanOrEqual(7);
    expect(byKey("f2").dueOffset).toBeGreaterThan(7);
    // A 30-day term: the due date is the invoice date plus 30 days.
    for (const invoice of fixture.invoices) expect(invoice.dueOffset - invoice.dateOffset).toBe(30);
    const manzo = (key: string) =>
      byKey(key).lines.find((l) => l.ingredient === "manzo")!.unitPrice;
    expect(manzo("f2")).toBeGreaterThan(manzo("f1") * 1.08);
    const expiring = fixture.invoices.flatMap((i) => i.lines).filter((l) => l.expiryOffset === 1);
    expect(expiring.map((l) => l.lotCode)).toEqual(["L-01"]);
    expect(byKey("f1").lines.find((l) => l.lotCode === "G-01")?.expiryOffset).toBe(10);
  });

  it("every date moves with today and nothing else: a second 'today' shifts every offset equally", () => {
    const other = buildFixture("2027-03-10");
    const dates = (f: DemoFixture) =>
      JSON.stringify({ ...f, today: undefined, fixedCosts: undefined, expected: undefined });
    expect(dates(fixture)).toBe(dates(other));
    expect(fixture.fixedCosts.month).toBe("2026-10-01");
    expect(other.fixedCosts.month).toBe("2027-03-01");
    // The only literal dates left are today and the first of its month.
    const literal = JSON.stringify(fixture).match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    expect(new Set(literal)).toEqual(new Set(["2026-10-24", "2026-10-01"]));
    expect(addDays(TODAY, fixture.invoices[0]!.dateOffset)).toBe("2026-09-19");
  });
});

// A small independent model of the week, recomputed from the data only ------------------------------------------------------------------
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function recipeOf(f: DemoFixture, key: string): DemoRecipe {
  return f.recipes.find((r) => r.key === key)!;
}

/** The raw ingredients (stock only) one production of `outputQty` consumes, from the current version. */
function consumption(f: DemoFixture, recipeKey: string, outputQty: number): Map<string, number> {
  const out = new Map<string, number>();
  const recipe = recipeOf(f, recipeKey);
  const current = recipe.versions[recipe.versions.length - 1]!;
  const scale = outputQty / (recipe.outputQty ?? 1);
  for (const l of current.lines) {
    if (l.ingredient) {
      if (!f.ingredients.find((i) => i.key === l.ingredient)!.isStock) continue;
      out.set(l.ingredient, r4((out.get(l.ingredient) ?? 0) + l.qty * scale));
    } else if (l.recipe) {
      for (const [k, v] of consumption(f, l.recipe, l.qty * scale)) {
        out.set(k, r4((out.get(k) ?? 0) + v));
      }
    }
  }
  return out;
}

function model(f: DemoFixture) {
  const stock = new Map<string, number>();
  const at = (ing: string, loc: string) => `${ing}@${loc}`;
  const add = (ing: string, loc: string, qty: number) =>
    stock.set(at(ing, loc), r4((stock.get(at(ing, loc)) ?? 0) + qty));
  for (const invoice of f.invoices.filter((i) => i.approve)) {
    for (const l of invoice.lines) add(l.ingredient, invoice.location, l.qty);
  }
  for (const t of f.stockOps.transfers) {
    add(t.ingredient, t.from, -t.qty);
    add(t.ingredient, t.to, t.qty);
  }
  for (const w of f.stockOps.waste) add(w.ingredient, w.location, -w.qty);
  for (const u of f.stockOps.manualUse) add(u.ingredient, u.location, -u.qty);
  let ragu = 0;
  let crema = 0;
  for (const p of f.productions) {
    for (const [ing, qty] of consumption(f, p.recipe, p.outputQty)) {
      add(ing, f.ingredients.find((i) => i.key === ing)!.home!, -qty);
    }
    const recipe = recipeOf(f, p.recipe);
    const portions = (recipe.portionsPerBatch ?? 0) * (p.outputQty / (recipe.outputQty ?? 1));
    if (p.recipe === "ragu") ragu += portions;
    if (p.recipe === "crema") crema += portions;
  }
  ragu -= f.batchActions.discard.portions + f.batchActions.staffMeal.count;
  ragu += f.batchActions.adjust.byPortions;
  const variance = f.count.counted.map((c) => {
    const expected = stock.get(at(c.ingredient, f.count.location)) ?? 0;
    add(c.ingredient, f.count.location, r4(c.qty - expected));
    return {
      ingredient: c.ingredient,
      expected,
      counted: c.qty,
      difference: r4(c.qty - expected),
    };
  });
  return { stock, ragu, crema, variance };
}

describe("expected values are what the data adds up to", () => {
  const m = model(fixture);

  it("on hand per ingredient and location", () => {
    for (const [ing, locations] of Object.entries(fixture.expected.onHand)) {
      for (const loc of fixture.locations.map((l) => l.key)) {
        expect({ ing, loc, qty: m.stock.get(`${ing}@${loc}`) ?? 0 }).toEqual({
          ing,
          loc,
          qty: locations[loc] ?? 0,
        });
      }
    }
    // Every stock ingredient is listed.
    expect(Object.keys(fixture.expected.onHand).sort()).toEqual(
      fixture.ingredients
        .filter((i) => i.isStock)
        .map((i) => i.key)
        .sort(),
    );
  });

  it("portions remaining: 80 produced, 6 discarded, 4 eaten by the staff, 2 fewer counted = 68", () => {
    expect(m.ragu).toBe(68);
    expect(fixture.expected.portions).toEqual({ ragu: 68, crema: 20 });
    expect(m.crema).toBe(20);
  });

  it("the daily count: manzo 7,6 counted against 8,0 expected is -0,4; guanciale is exact", () => {
    expect(m.variance).toEqual(fixture.expected.variance);
    expect(m.variance[0]).toEqual({
      ingredient: "manzo",
      expected: 8,
      counted: 7.6,
      difference: -0.4,
    });
  });

  it("the rules make the alerts the plan lists", () => {
    const ragu = recipeOf(fixture, "ragu");
    const crema = recipeOf(fixture, "crema");
    // prep_due: below the minimum, with enough raw for a batch (manzo 7,6 >= 5).
    expect(m.ragu).toBeLessThan(ragu.rules!.minPortions);
    expect(consumption(fixture, "ragu", 8).get("manzo")!).toBeLessThanOrEqual(
      m.stock.get("manzo@cella")!,
    );
    // prep_raw_short: below the minimum, and not enough eggs for a batch (6 < 12).
    expect(m.crema).toBeLessThan(crema.rules!.minPortions);
    expect(consumption(fixture, "crema", 2.5).get("uova")!).toBeGreaterThan(
      m.stock.get("uova@cella")!,
    );
    // purchase_due: guanciale 2 < min 3.
    const rule = fixture.ingredientRules.find((r) => r.ingredient === "guanciale")!;
    expect(m.stock.get("guanciale@cella")!).toBeLessThan(rule.minLevel);
    // batch_expiring: the crema use-by is within 24 hours.
    expect(crema.shelfLifeHours!).toBeLessThan(24);
  });

  it("lists the alert kinds once each, all known kinds", () => {
    const kinds = fixture.expected.alertKinds;
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual(expect.arrayContaining(["prep_due", "prep_raw_short", "purchase_due"]));
  });

  it("counts the invoices and the payable states", () => {
    expect(fixture.invoices.filter((i) => i.approve)).toHaveLength(
      fixture.expected.invoicesApproved,
    );
    expect(fixture.invoices.filter((i) => !i.approve)).toHaveLength(
      fixture.expected.invoicesInReview,
    );
    for (const [key, state] of Object.entries(fixture.expected.payables)) {
      const invoice = fixture.invoices.find((i) => i.key === key)!;
      const expected = invoice.paid
        ? "paid"
        : invoice.dueOffset < 0
          ? "overdue"
          : invoice.dueOffset <= 7
            ? "due_soon"
            : "open";
      expect({ key, state }).toEqual({ key, state: expected });
    }
  });

  it("the plates sell at 14,00 and 6,50 and use a batch recipe", () => {
    expect(recipeOf(fixture, "tagliatelle").salePrice).toBe(14);
    expect(recipeOf(fixture, "bigne").salePrice).toBe(6.5);
    expect(recipeOf(fixture, "ragu").versions).toHaveLength(2);
    const [v1, v2] = recipeOf(fixture, "ragu").versions;
    const wine = (v: typeof v1) => v!.lines.find((l) => l.ingredient === "vino")!.qty;
    expect(wine(v2)).toBeGreaterThan(wine(v1));
  });
});

describe("the fake invoice file", () => {
  const bytes = demoInvoicePdf();
  const text = Buffer.from(bytes).toString("latin1");

  it("is a PDF under 4 MiB that says it has no fiscal value", () => {
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(bytes.length).toBeGreaterThan(200);
    expect(bytes.length).toBeLessThan(4 * 1024 * 1024);
    expect(text).toContain("senza valore fiscale");
    expect(text).toContain("FATTURA DI PROVA \\(demo\\)");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("has an exact cross-reference table", () => {
    const start = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const entries = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(entries).toHaveLength(5);
    entries.forEach((offset, index) => {
      expect(text.slice(offset, offset + 8)).toBe(`${index + 1} 0 obj\n`);
    });
  });

  it("is the same bytes every time", () => {
    expect(Buffer.from(demoInvoicePdf()).equals(Buffer.from(bytes))).toBe(true);
  });
});
