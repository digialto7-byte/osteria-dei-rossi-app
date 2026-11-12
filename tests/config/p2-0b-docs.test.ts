import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// P2-0b plan B10: the ADR and the Italian guide for selling by weight. The ADR records the decisions and the rejected alternatives;
// the guide is for the person who runs the app for the venue, says no legal or fiscal rule, and holds no client fact (no real dish,
// price or weight): every figure in it is the demo's.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("docs/adr/adr-035-sell-by-weight.md", () => {
  const text = read("docs/adr/adr-035-sell-by-weight.md");

  it("is ADR-035 with a status, a date and the usual sections", () => {
    expect(text).toMatch(/^# ADR-035[:\s—-]/);
    expect(text).toMatch(/\n- \*\*Status:\*\*/);
    expect(text).toMatch(/\n- \*\*Date:\*\*/);
    for (const section of ["## Context", "## Decision", "## Alternatives", "## Consequences"]) {
      expect(text, section).toContain(section);
    }
  });

  it.each(["D-2", "D-4", "D-11", "L-1", "L-2", "L-3", "L-4", "L-5", "P-1", "P-2", "P-3", "P-4"])(
    "records decision %s",
    (id) => {
      expect(text).toContain(id);
    },
  );

  it("records the rejected alternatives of the plan", () => {
    for (const phrase of [
      "per kg or per etto on the line",
      "`qty` = the portion fraction",
      "CHECK constraint",
      "app-level value",
      "per menu item",
      "tenant.settings",
      "set_sale_settings",
      "recipe version",
      "sold_by_weight",
      "menu_item_price_at",
      "separate `order_line_weight` table",
      "price preview computed in the browser",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("states the rule: half-up to the cent, once, in SQL, with the trigger and not a CHECK", () => {
    expect(text).toMatch(/half-up/);
    expect(text).toContain("app.weight_line_price");
    expect(text).toContain("order_line_weight_price");
  });

  it("names no model identifier, secret or real client price", () => {
    expect(text).not.toMatch(/claude-|sk-|api[_-]?key\s*[:=]/i);
    for (const real of ["9 € / 100 g", "12 € / 100 g", "7 € / 100 g"]) {
      expect(text).not.toContain(real);
    }
  });
});

describe("docs/guides/vendita-a-peso.md", () => {
  const text = read("docs/guides/vendita-a-peso.md");

  it("is Italian and covers each topic the plan lists", () => {
    for (const heading of [
      "Mettere un piatto a peso",
      "La porzione di riferimento",
      "Peso massimo per riga",
      "Scorte e costo",
      "Correggere un peso",
      "Dal segnaposto alla vendita a peso",
    ]) {
      expect(text, heading).toContain(`## ${heading}`);
    }
  });

  it("uses the screen words of the app", () => {
    for (const word of [
      "Venduto a peso",
      "Prezzo per etto (100 g)",
      "Porzione di riferimento (g)",
      "Ripristina",
      "Confermi",
    ]) {
      expect(text, word).toContain(word);
    }
  });

  it("states no legal or fiscal rule and invents no client fact", () => {
    expect(text).not.toMatch(
      /\b(obbligo di legge|per legge|è obbligatorio per|normativa|decreto)\b/i,
    );
    expect(text).toMatch(/non è un documento fiscale|scontrino fiscale è fuori dall'app/i);
    expect(text).not.toMatch(/Fiorentina|Vamosh/);
    expect(text).not.toMatch(/\b(9|12|7) ?€ ?\/ ?(100 ?g|etto)/);
  });

  it("holds no secret and no model identifier", () => {
    expect(text).not.toMatch(/claude-|sk-[a-z0-9]|api[_-]?key\s*[:=]/i);
  });
});
