import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionPanel } from "@/app/(owner)/produzione/[id]/action-panel";
import { CELLA, DISPENSA } from "./batch-fixtures";

type Props = Parameters<typeof ActionPanel>[0];
const LOCATIONS = [
  { id: CELLA, name: "Cella (demo)" },
  { id: DISPENSA, name: "Congelatore (demo)" },
];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(ActionPanel, {
      can: { adjust: true, discard: true, split: true },
      remaining: 6,
      hoursLeft: 24,
      locations: LOCATIONS,
      busy: false,
      error: null,
      onAdjust: async () => true,
      onDiscard: async () => true,
      onSplit: async () => true,
      ...over,
    }),
  );
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1]!,
    text: m[2]!.replace(/<[^>]*>/g, ""),
  }));
const primaries = (html: string) =>
  buttons(html).filter((b) => b.attrs.includes("bg-accent") && !b.attrs.includes("border-ink"));

describe("ActionPanel, closed", () => {
  it("shows the three secondary buttons and no primary", () => {
    const html = render();
    expect(buttons(html).map((b) => b.text)).toEqual(["Conta", "Scarta", "Dividi"]);
    expect(primaries(html)).toHaveLength(0);
    for (const b of buttons(html)) expect(b.attrs).toContain("border-ink");
  });

  it("hides what the batch cannot do (can)", () => {
    const html = render({ can: { adjust: true, discard: false, split: false } });
    expect(buttons(html).map((b) => b.text)).toEqual(["Conta"]);
  });

  it("shows no form and no euro sign", () => {
    const html = render();
    expect(html).not.toContain("<form");
    expect(html).not.toContain("€");
  });
});

describe("ActionPanel, Conta", () => {
  const html = render({ initialOpen: "adjust" });

  it("has one decimal field 'Porzioni contate' with the expected number as a hint", () => {
    expect(html).toMatch(/<label[^>]*>\s*<span[^>]*>Porzioni contate<\/span>/);
    expect(html).toMatch(/<input[^>]*inputMode="decimal"/);
    expect(html).toContain("Attese: 6");
  });

  it("has exactly one primary button, 'Registra conteggio'", () => {
    expect(primaries(html).map((b) => b.text)).toEqual(["Registra conteggio"]);
    expect(html.match(/<form/g)).toHaveLength(1);
  });
});

describe("ActionPanel, Scarta", () => {
  const html = render({ initialOpen: "discard" });

  it("has the portions field, a 'Tutte (6)' text button and the reason select", () => {
    expect(html).toMatch(/<span[^>]*>Porzioni da scartare<\/span>/);
    expect(html).toMatch(/<input[^>]*inputMode="decimal"/);
    expect(buttons(html).map((b) => b.text)).toContain("Tutte (6)");
    expect(html).toMatch(/<span[^>]*>Motivo<\/span>/);
  });

  it("lists exactly the seven Italian reasons, with the codes as values", () => {
    const select = /<select[^>]*name="reason"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    const options = [...select.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(options.filter(([value]) => value !== "")).toEqual([
      ["spoilage", "Deteriorato"],
      ["expired", "Scaduto"],
      ["over_production", "Sovrapproduzione"],
      ["plating_error", "Errore di impiattamento"],
      ["staff_meal", "Pasto del personale"],
      ["comp", "Omaggio"],
      ["breakage", "Rottura"],
    ]);
    expect(select).not.toContain("Correzione di conteggio");
  });

  it("has exactly one primary button, 'Registra scarto'", () => {
    expect(primaries(html).map((b) => b.text)).toEqual(["Registra scarto"]);
  });
});

describe("ActionPanel, Dividi", () => {
  const html = render({ initialOpen: "split" });

  it("has a whole-number field, the location select and the hours prefilled with the hours left", () => {
    expect(html).toMatch(/<span[^>]*>Porzioni da spostare<\/span>/);
    expect(html).toMatch(/<input[^>]*inputMode="numeric"/);
    expect(html).toMatch(/<span[^>]*>Ubicazione<\/span>/);
    expect(html).toMatch(/<span[^>]*>Conservazione da adesso \(ore\)<\/span>/);
    expect(html).toMatch(/<input[^>]*name="hours"[^>]*value="24"/);
    expect(html).toContain("Per il congelatore indica la nuova durata.");
  });

  it("asks for the location only with two or more", () => {
    expect(render({ initialOpen: "split", locations: [LOCATIONS[0]!] })).not.toContain(
      "Ubicazione",
    );
  });

  it("leaves the hours empty when the batch has none left to suggest", () => {
    const empty = render({ initialOpen: "split", hoursLeft: null });
    expect(empty).toMatch(/<input[^>]*name="hours"[^>]*value=""/);
  });

  it("has exactly one primary button, 'Dividi lotto'", () => {
    expect(primaries(html).map((b) => b.text)).toEqual(["Dividi lotto"]);
  });
});

describe("ActionPanel, errors and busy", () => {
  it("shows the server's Italian error in an alert", () => {
    const html = render({
      initialOpen: "discard",
      error: "Non ci sono abbastanza porzioni in questo lotto.",
    });
    expect(html).toMatch(
      /<p role="alert"[^>]*>Non ci sono abbastanza porzioni in questo lotto\.<\/p>/,
    );
    const expired = render({
      initialOpen: "split",
      error: "Il lotto è scaduto: non si può dividere.",
    });
    expect(expired).toContain("Il lotto è scaduto: non si può dividere.");
  });

  it("disables the primary button while a request is on its way", () => {
    expect(render({ initialOpen: "adjust", busy: true })).toMatch(
      /<button[^>]*disabled=""[^>]*>Registra conteggio<\/button>/,
    );
  });

  it("has English words", () => {
    const html = renderToStaticMarkup(
      createElement(ActionPanel, {
        can: { adjust: true, discard: true, split: true },
        remaining: 6,
        hoursLeft: 24,
        locations: LOCATIONS,
        busy: false,
        error: null,
        onAdjust: async () => true,
        onDiscard: async () => true,
        onSplit: async () => true,
        locale: "en",
      }),
    );
    expect(buttons(html).map((b) => b.text)).toEqual(["Count", "Discard", "Split"]);
  });
});
