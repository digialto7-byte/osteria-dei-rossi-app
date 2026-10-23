import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertRow } from "@/app/(owner)/avvisi/alert-row";
import type { AlertItem } from "@/server/alerts/list";

const ITEM: AlertItem = {
  id: "a1000000-0000-4000-8000-000000000001",
  kind: "test_alert",
  severity: "info",
  entityType: "tenant",
  entityId: null,
  businessDate: "2026-10-25",
  createdAt: "2026-10-25T00:30:00+00:00",
  title: "Avviso di prova",
  body: "Se leggi questo avviso, gli avvisi funzionano.",
  acknowledged: null,
};

const render = (overrides: Partial<AlertItem> = {}, busy = false) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(AlertRow, { alert: { ...ITEM, ...overrides }, busy, onAcknowledge: () => {} }),
    ),
  );

describe("AlertRow", () => {
  it("shows the severity as a word in a badge, not colour only", () => {
    expect(render()).toMatch(/<span aria-hidden="true"[^>]*><\/span>Informazione/);
    expect(render({ severity: "critical" })).toMatch(/bg-danger-bg[^>]*>[\s\S]*Urgente/);
    expect(render({ severity: "warning" })).toContain("Attenzione");
  });

  it("shows the title in bold and the body", () => {
    const html = render();
    expect(html).toMatch(/<[^>]*font-bold[^>]*>Avviso di prova</);
    expect(html).toContain("Se leggi questo avviso, gli avvisi funzionano.");
  });

  it("'Ho visto' is a secondary button, one per open alert", () => {
    const html = render();
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*border-ink[^>]*>Ho visto<\/button>/);
    expect(html).not.toMatch(/bg-accent/);
  });

  it("disables the button while the request is on its way", () => {
    expect(render({}, true)).toMatch(/<button[^>]*disabled=""[^>]*>Ho visto<\/button>/);
  });

  it("an acknowledged alert has no button and says who saw it and when", () => {
    const html = render({ acknowledged: { at: "2026-10-25T08:12:00Z", byName: "Titolare Demo" } });
    expect(html).not.toContain("<button");
    expect(html).toContain("Visto il 25/10/2026, 09:12 da Titolare Demo");
  });

  it("an acknowledgement without a name shows no person", () => {
    const html = render({ acknowledged: { at: "2026-10-25T08:12:00Z", byName: null } });
    expect(html).toContain("Visto il 25/10/2026, 09:12<");
    expect(html).not.toContain(" da ");
  });

  it("the meta line is in .num and uses venue time", () => {
    expect(render()).toMatch(/<[^>]*class="[^"]*\bnum\b[^"]*"[^>]*>del 25\/10\/2026, 02:30</);
  });

  it("renders title and body escaped, so markup stays text", () => {
    const html = render({
      title: "<script>alert(1)</script>",
      body: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("never mentions email", () => {
    expect(render()).not.toMatch(/e-?mail/i);
  });
});
