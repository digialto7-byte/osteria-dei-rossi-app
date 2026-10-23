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
