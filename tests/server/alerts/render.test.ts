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
    expect(renderAlert(row("price_variance", { note: secret }))).toEqual(FALLBACK);
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = vi.mocked(reportError).mock.calls[0]![0];
    expect(String(reported instanceof Error ? reported.message : reported)).toContain(ID);
    expect(String(reported instanceof Error ? reported.message : reported)).toContain(
      "price_variance",
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
