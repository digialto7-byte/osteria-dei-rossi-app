import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { messages } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import { renderAlert } from "@/server/alerts/render";
import { defineTemplate, type AlertTemplate } from "@/server/alerts/templates";

vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const ID = "a1a1a1a1-0000-4000-8000-000000000001";
const row = (kind: string, payload: unknown = {}) => ({ id: ID, kind, payload });

// A fixture kind that exercises every payload convention (money, quantity + unit, date, instant, text).
// It is not a registered kind: the registry is passed in, and its two texts are added to the
// catalogues for the length of this file.
const FIXTURE = "fixture_alert";
const TITLE = "alerts.kind.fixture_alert.title" as MessageKey;
const BODY = "alerts.kind.fixture_alert.body" as MessageKey;
const fixture: AlertTemplate = defineTemplate({
  payload: z.strictObject({
    price_eur: z.number(),
    needed_qty: z.number(),
    unit: z.enum(["kg", "l", "pz"]),
    due_date: z.iso.date(),
    seen_at: z.iso.datetime({ offset: true }),
    supplier_name: z.string().max(200),
  }),
  moneyFields: ["price_eur"],
  titleKey: TITLE,
  bodyKey: BODY,
  params: (p, f) => ({
    name: p.supplier_name,
    price: f.eur(p.price_eur),
    qty: f.qty(p.needed_qty, p.unit),
    due: f.date(p.due_date),
    seen: f.instant(p.seen_at),
  }),
});
const REGISTRY = { [FIXTURE]: fixture };
const FIXTURE_PAYLOAD = {
  price_eur: 1234.5,
  needed_qty: 5,
  unit: "kg",
  due_date: "2026-12-10",
  seen_at: "2026-10-25T00:30:00Z",
  supplier_name: "Fornitore Demo",
};

const catalogues = messages as unknown as Record<"it" | "en", Record<string, string>>;
beforeAll(() => {
  catalogues.it[TITLE] = "Prova {name}";
  catalogues.it[BODY] = "{price} · {qty} · entro {due} · visto {seen}";
  catalogues.en[TITLE] = "Fixture {name}";
  catalogues.en[BODY] = "{price} · {qty} · by {due} · seen {seen}";
});
afterAll(() => {
  for (const locale of ["it", "en"] as const) {
    delete catalogues[locale][TITLE];
    delete catalogues[locale][BODY];
  }
});
beforeEach(() => vi.mocked(reportError).mockClear());

describe("renderAlert: registered kinds", () => {
  it("renders the test alert in Italian by default and in English on request", () => {
    expect(renderAlert(row("test_alert"))).toEqual({
      title: "Avviso di prova",
      body: "Se leggi questo avviso, gli avvisi funzionano.",
    });
    expect(renderAlert(row("test_alert"), "en")).toEqual({
      title: "Test alert",
      body: "If you can read this, alerts work.",
    });
  });

  it("renders the kitchen test alert", () => {
    expect(renderAlert(row("test_alert_kitchen")).title).toBe("Avviso di prova per la cucina");
    expect(renderAlert(row("test_alert_kitchen"), "en").title).toBe("Kitchen test alert");
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("renderAlert: negative_stock (M12)", () => {
  const payload = {
    ingredient_id: "1a000000-0000-4000-8000-00000000001a",
    location_id: "10000000-0000-4000-8000-0000000000a1",
    on_hand_qty: -1,
    unit: "kg",
    movement_id: "0e000000-0000-4000-8000-0000000000e1",
  };
  const names = {
    ingredient: new Map([[payload.ingredient_id, "Manzo muscolo (demo)"]]),
    location: new Map([[payload.location_id, "Cella (demo)"]]),
  };

  it("renders the names, the signed quantity and the advice, in Italian", () => {
    expect(renderAlert(row("negative_stock", payload), "it", undefined, names)).toEqual({
      title: "Scorta negativa: Manzo muscolo (demo)",
      body: "Cella (demo): giacenza \u22121\u00a0kg. Fai un conteggio o approva la fattura mancante.",
    });
  });

  it("renders in English", () => {
    const { title, body } = renderAlert(row("negative_stock", payload), "en", undefined, names);
    expect(title).toBe("Negative stock: Manzo muscolo (demo)");
    expect(body).toContain("Cella (demo): on hand \u22121\u00a0kg.");
  });

  it("a missing name shows a neutral word, never the id", () => {
    const { title, body } = renderAlert(row("negative_stock", payload), "it");
    expect(title).toBe("Scorta negativa: ingrediente non disponibile");
    expect(body).toContain("ubicazione non disponibile");
    expect(title + body).not.toContain(payload.ingredient_id);
  });

  it("contains no euro sign, and keeps markup in a name as text", () => {
    const hostile = {
      ingredient: new Map([[payload.ingredient_id, "<script>alert(1)</script>"]]),
      location: names.location,
    };
    const { title, body } = renderAlert(row("negative_stock", payload), "it", undefined, hostile);
    expect(title).toBe("Scorta negativa: <script>alert(1)</script>");
    expect(title + body).not.toMatch(/€|eur/i);
    expect(renderAlert(row("negative_stock", payload), "it", undefined, names).body).not.toMatch(
      /€/,
    );
  });

  it("a payload that fails the schema shows the fallback", () => {
    expect(renderAlert(row("negative_stock", { ...payload, extra: 1 }), "it").title).toBe("Avviso");
  });
});

describe("renderAlert: ledger_drift (M13)", () => {
  const payload = {
    checks: [
      { check_key: "lot_receipt_missing", rows_count: 2, sample_ids: [] },
      { check_key: "job_stale", rows_count: 1, sample_ids: [], job_key: "alert-rules" },
    ],
    checked_at: "2026-10-24T02:45:00Z",
  };

  it("names every failing check in Italian", () => {
    expect(renderAlert(row("ledger_drift", payload), "it")).toEqual({
      title: "Controllo notturno: 2 problemi nei registri",
      body: "lotti senza carico; attività pianificata ferma: alert-rules. Contatta l'assistenza.",
    });
  });

  it("uses the singular for one check, and renders in English", () => {
    const one = { ...payload, checks: [payload.checks[0]] };
    expect(renderAlert(row("ledger_drift", one), "it").title).toBe(
      "Controllo notturno: 1 problema nei registri",
    );
    const { title, body } = renderAlert(row("ledger_drift", payload), "en");
    expect(title).toBe("Nightly check: 2 problems in the records");
    expect(body).toContain("lots without a receipt");
    expect(body).toContain("scheduled job stopped: alert-rules");
  });

  it("contains no euro sign and shows no id", () => {
    const withIds = {
      ...payload,
      checks: [
        {
          check_key: "lot_negative",
          rows_count: 1,
          sample_ids: ["10700000-0000-4000-8000-0000000000a1"],
        },
      ],
    };
    const { title, body } = renderAlert(row("ledger_drift", withIds), "it");
    expect(title + body).not.toMatch(/€|10700000/);
  });

  it("a payload that fails the schema shows the fallback", () => {
    const bad = { ...payload, checks: [{ check_key: "nope", rows_count: 1, sample_ids: [] }] };
    expect(renderAlert(row("ledger_drift", bad), "it").title).toBe("Avviso");
  });
});

describe("renderAlert: payload conventions", () => {
  it("formats money, quantity, calendar date and instant in Italian", () => {
    const { title, body } = renderAlert(row(FIXTURE, FIXTURE_PAYLOAD), "it", REGISTRY);
    expect(title).toBe("Prova Fornitore Demo");
    expect(body).toBe("1.234,50 € · 5 kg · entro 10/12/2026 · visto 25/10/2026, 02:30");
  });

  it("formats them the English way", () => {
    const { body } = renderAlert(row(FIXTURE, FIXTURE_PAYLOAD), "en", REGISTRY);
    expect(body).toBe("€1,234.50 · 5 kg · by 10/12/2026 · seen 25/10/2026, 02:30");
  });

  it("keeps markup in a payload string as plain text (React escapes it on screen)", () => {
    const payload = { ...FIXTURE_PAYLOAD, supplier_name: "<script>alert(1)</script>" };
    expect(renderAlert(row(FIXTURE, payload), "it", REGISTRY).title).toBe(
      "Prova <script>alert(1)</script>",
    );
  });

  it.each([
    ["2026-10-25T00:30:00Z", "25/10/2026, 02:30"],
    ["2026-10-25T01:30:00Z", "25/10/2026, 02:30"],
    ["2027-03-28T01:30:00Z", "28/03/2027, 03:30"],
  ])("shows the instant %s in Europe/Rome as %s (DST)", (seenAt, shown) => {
    const { body } = renderAlert(
      row(FIXTURE, { ...FIXTURE_PAYLOAD, seen_at: seenAt }),
      "it",
      REGISTRY,
    );
    expect(body).toContain(`visto ${shown}`);
  });
});

describe("renderAlert: fallback", () => {
  const FALLBACK = { title: "Avviso", body: "Apri l'app per i dettagli." };

  it("an unknown kind shows the fallback and reports the id and the kind only", () => {
    const secret = "SEGRETO-12345";
    expect(renderAlert(row("no_such_kind", { note: secret }))).toEqual(FALLBACK);
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = vi.mocked(reportError).mock.calls[0]![0];
    expect(String(reported instanceof Error ? reported.message : reported)).toContain(ID);
    expect(String(reported instanceof Error ? reported.message : reported)).toContain(
      "no_such_kind",
    );
    expect(JSON.stringify(vi.mocked(reportError).mock.calls)).not.toContain(secret);
  });

  it("a payload that fails its schema shows the fallback; the report has no payload value", () => {
    const secret = "SEGRETO-67890";
    const bad = { ...FIXTURE_PAYLOAD, price_eur: secret };
    expect(renderAlert(row(FIXTURE, bad), "it", REGISTRY)).toEqual(FALLBACK);
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = vi.mocked(reportError).mock.calls[0]![0] as Error;
    expect(reported.message).toContain(ID);
    expect(reported.message).toContain(FIXTURE);
    expect(JSON.stringify(vi.mocked(reportError).mock.calls)).not.toContain(secret);
    expect(reported.stack ?? "").not.toContain(secret);
  });

  it("a payload with an unexpected key also falls back", () => {
    expect(renderAlert(row("test_alert", { extra: 1 }))).toEqual(FALLBACK);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("the fallback is translated", () => {
    expect(renderAlert(row("nope"), "en")).toEqual({
      title: "Alert",
      body: "Open the app for details.",
    });
  });

  it("an inherited name is not a kind", () => {
    expect(renderAlert(row("constructor"))).toEqual(FALLBACK);
  });
});

describe("renderAlert: price_variance", () => {
  const plate = (name: string, extra: Record<string, unknown> = {}) => ({
    recipe_key: "ec000000-0000-4000-8000-0000000000e2",
    type: "plate",
    name,
    unit_cost_eur: 2.1,
    cost_unit: "piatto",
    margin_eur: 8.48,
    gp_pct: 77.7,
    target_gp_pct: 70,
    status: "ok",
    ...extra,
  });
  const base = {
    ingredient_id: "1a000000-0000-4000-8000-00000000001a",
    ingredient_name: "Manzo muscolo (demo)",
    unit: "kg",
    invoice_id: "00000000-0000-4000-8000-000000000021",
    invoice_number: "FT 21",
    supplier_id: "5a000000-0000-4000-8000-00000000005a",
    supplier_name: "Fornitore Demo Srl",
    new_price_eur: 11.1,
    baseline_eur: 10,
    change_pct: 11,
    threshold_pct: 10,
    purchases_in_baseline: 3,
    recipes_count: 2,
    recipes_listed: 2,
    recipes: [
      plate("Spezzatino con polenta (demo)"),
      plate("Spezzatino al vino (demo)", { margin_eur: 6.1, gp_pct: 55.9, status: "below_target" }),
    ],
  };
  const NB = "\u00a0";

  it("renders the title with the signed change and the body with prices, plates and margins (it)", () => {
    const { title, body } = renderAlert(row("price_variance", base));
    expect(title).toBe(`Prezzo cambiato: Manzo muscolo (demo) +11,0${NB}%`);
    expect(body).toBe(
      `Nuovo prezzo 11,10${NB}€/kg, media degli ultimi 3 acquisti 10,00${NB}€/kg (fattura FT 21, Fornitore Demo Srl). ` +
        `Ricette coinvolte: 2. Spezzatino con polenta (demo) — margine 8,48${NB}€, GP 77,7${NB}% (In linea); ` +
        `Spezzatino al vino (demo) — margine 6,10${NB}€, GP 55,9${NB}% (Sotto obiettivo).`,
    );
    expect(reportError).not.toHaveBeenCalled();
  });

  it("renders the English forms", () => {
    const { title, body } = renderAlert(row("price_variance", base), "en");
    expect(title).toBe("Price changed: Manzo muscolo (demo) +11.0%");
    expect(body).toContain("New price €11.10/kg, average of the last 3 purchases €10.00/kg");
    expect(body).toContain("(invoice FT 21, Fornitore Demo Srl). Recipes affected: 2.");
    expect(body).toContain("margin €6.10, GP 55.9% (Below target)");
  });

  it("says how many recipes are not listed: 41 recipes, 20 listed", () => {
    const payload = {
      ...base,
      recipes_count: 41,
      recipes_listed: 20,
      recipes: Array.from({ length: 20 }, (_, i) => plate(`Piatto ${i} (demo)`)),
    };
    expect(renderAlert(row("price_variance", payload)).body.endsWith("; e altre 21 ricette.")).toBe(
      true,
    );
    expect(
      renderAlert(row("price_variance", payload), "en").body.endsWith("; and 21 more recipes."),
    ).toBe(true);
    const one = { ...payload, recipes_count: 21 };
    expect(renderAlert(row("price_variance", one)).body.endsWith("; e altra 1 ricetta.")).toBe(
      true,
    );
  });

  it("rounds a 4-decimal change and GP once, to one decimal", () => {
    const four = {
      ...base,
      change_pct: 11.1458,
      recipes: [plate("Spezzatino al vino (demo)", { gp_pct: 81.1458 })],
    };
    const { title, body } = renderAlert(row("price_variance", four));
    expect(title).toBe(`Prezzo cambiato: Manzo muscolo (demo) +11,1${NB}%`);
    expect(body).toContain(`81,1${NB}%`);
    expect(body).not.toContain(`81,2${NB}%`);
  });

  it("renders a decrease with a minus sign", () => {
    expect(renderAlert(row("price_variance", { ...base, change_pct: -12 })).title).toBe(
      `Prezzo cambiato: Manzo muscolo (demo) \u221212,0${NB}%`,
    );
  });

  it("names plates only and shows a dash for a plate whose cost is unknown", () => {
    const payload = {
      ...base,
      recipes_count: 2,
      recipes: [
        {
          recipe_key: base.recipes[0]!.recipe_key,
          type: "batch",
          name: "Spezzatino (demo)",
          unit_cost_eur: 1.85,
          cost_unit: "porz",
        },
        plate("Piatto senza prezzo (demo)", {
          margin_eur: null,
          gp_pct: null,
          status: "incomplete",
        }),
      ],
    };
    const { body } = renderAlert(row("price_variance", payload));
    expect(body).not.toContain("Spezzatino (demo)");
    expect(body).toContain(`Piatto senza prezzo (demo) — margine —, GP — (Dati incompleti)`);
  });

  it("a payload that fails the schema shows the fallback", () => {
    expect(renderAlert(row("price_variance", { ...base, change_pct: "x" }))).toEqual({
      title: "Avviso",
      body: "Apri l'app per i dettagli.",
    });
  });
});

describe("renderAlert: payable kinds (M9)", () => {
  const NB = "\u00a0";
  const reminder = {
    payable_id: "90000000-0000-4000-8000-000000000001",
    invoice_id: "e0000000-0000-4000-8000-000000000001",
    invoice_number: "FT 123/A",
    supplier_id: "5a000000-0000-4000-8000-00000000005a",
    supplier_name: "Fornitore Demo Srl",
    amount_eur: 1234.5,
    due_date: "2026-12-10",
  };
  const entry = (n: number, extra: Record<string, unknown> = {}) => ({
    supplier_id: `5a000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    supplier_name: `Fornitore Demo ${n}`,
    payables_count: 2,
    amount_eur: 1234.5,
    overdue_count: 0,
    next_due_date: "2026-12-10",
    ...extra,
  });
  const digest = (suppliers: unknown[], count = suppliers.length) => ({
    week_start_date: "2026-10-26",
    as_of_date: "2026-10-26",
    payables_count: 3,
    amount_eur: 2000,
    overdue_count: 1,
    overdue_amount_eur: 100,
    suppliers_count: count,
    suppliers_listed: suppliers.length,
    suppliers,
  });

  it("payable_due_7d: supplier, invoice, amount and due date (it)", () => {
    const { title, body } = renderAlert(row("payable_due_7d", reminder));
    expect(title).toBe("Pagamento in scadenza");
    expect(body).toBe(
      `Fornitore Demo Srl: fattura FT 123/A, 1.234,50${NB}\u20ac, scade il 10/12/2026.`,
    );
  });

  it("payable_due_today and payable_overdue_3d use their own wording", () => {
    const today = renderAlert(row("payable_due_today", reminder));
    expect(today.title).toBe("Pagamento alla scadenza");
    expect(today.body).toContain("scadenza 10/12/2026");
    const late = renderAlert(row("payable_overdue_3d", reminder));
    expect(late.title).toBe("Pagamento scaduto");
    expect(late.body).toContain("scaduta il 10/12/2026");
  });

  it("renders the English forms", () => {
    const { title, body } = renderAlert(row("payable_due_7d", reminder), "en");
    expect(title).toBe("Payment due soon");
    expect(body).toContain("invoice FT 123/A");
    expect(body).toContain("\u20ac1,234.50");
    expect(body).toContain("due 10/12/2026");
  });

  it("a supplier name with markup stays text", () => {
    const { body } = renderAlert(
      row("payable_due_7d", { ...reminder, supplier_name: "<script>alert(1)</script>" }),
    );
    expect(body.startsWith("<script>alert(1)</script>: fattura")).toBe(true);
  });

  it("the digest lists the suppliers with amount and count, and the totals", () => {
    const { title, body } = renderAlert(
      row("payables_weekly_digest", digest([entry(1), entry(2, { payables_count: 1 })])),
    );
    expect(title).toBe("Pagamenti della settimana");
    expect(body).toBe(
      `Al 26/10/2026: 3 fatture da pagare, 2.000,00${NB}\u20ac (1 scaduta). ` +
        `Fornitore Demo 1 1.234,50${NB}\u20ac (2); Fornitore Demo 2 1.234,50${NB}\u20ac (1).`,
    );
  });

  it("the digest says how many suppliers are not listed: 16 suppliers, 15 listed", () => {
    const listed = Array.from({ length: 15 }, (_, i) => entry(i + 1));
    const body = renderAlert(row("payables_weekly_digest", digest(listed, 16))).body;
    // Singular and plural are separate texts (M8's "e altra 1 ricetta" pattern), not "1 fornitori".
    expect(body.endsWith("; e altro 1 fornitore.")).toBe(true);
    const two = renderAlert(row("payables_weekly_digest", digest(listed, 17))).body;
    expect(two.endsWith("; e altri 2 fornitori.")).toBe(true);
    const en = renderAlert(row("payables_weekly_digest", digest(listed, 17)), "en").body;
    expect(en.endsWith("; and 2 more suppliers.")).toBe(true);
  });

  it("a bad payload shows the fallback, reported by id and kind only", () => {
    const rendered = renderAlert(row("payable_due_7d", { ...reminder, amount_eur: "x" }));
    expect(rendered).toEqual({ title: "Avviso", body: "Apri l'app per i dettagli." });
    expect(reportError).toHaveBeenCalledTimes(1);
    const text = String(vi.mocked(reportError).mock.calls[0]![0]);
    expect(text).toContain(ID);
    expect(text).toContain("payable_due_7d");
    expect(text).not.toContain("Fornitore Demo Srl");
  });
});
