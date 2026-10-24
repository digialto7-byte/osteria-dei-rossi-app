import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopertoCard } from "@/app/(owner)/tavoli/impostazioni/coperto-card";
import { COPERTO_READ } from "../helpers/menu-tables-data";

type Props = Parameters<typeof CopertoCard>[0];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(CopertoCard, {
      coperto: COPERTO_READ.coperto,
      defaultVatRate: COPERTO_READ.defaults.vatRate,
      vatRates: COPERTO_READ.vatRates,
      busy: false,
      error: null,
      onSave: () => undefined,
      ...over,
    }),
  );

describe("CopertoCard", () => {
  it("shows the amount with a decimal comma and the VAT rate of the coperto", () => {
    const html = render();
    expect(html).toContain("Coperto a persona (€)");
    expect(html).toMatch(
      /<input[^>]*inputMode="decimal"[^>]*value="1,50"|<input[^>]*value="1,50"[^>]*inputMode="decimal"/,
    );
    const select = /<select[^>]*name="copertoVatRate"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(select).toMatch(/<option[^>]*value="10"[^>]*selected[^>]*>10 %<\/option>/);
    expect(select.match(/<option/g)).toHaveLength(5);
  });

  it("with no coperto the amount is empty and the rate is the default (two tenants: 10 and 22)", () => {
    const owner = render({ coperto: null });
    expect(owner).toMatch(
      /<input[^>]*name="copertoAmount"[^>]*value=""|<input[^>]*value=""[^>]*name="copertoAmount"/,
    );
    expect(owner).toMatch(/<option[^>]*value="10"[^>]*selected/);
    const other = render({ coperto: null, defaultVatRate: 22 });
    expect(other).toMatch(/<option[^>]*value="22"[^>]*selected/);
    expect(other).not.toMatch(/<option[^>]*value="10"[^>]*selected/);
  });

  it("a set coperto keeps its own rate, not the default", () => {
    const html = render({ coperto: { amount: 2, vatRate: 4 }, defaultVatRate: 22 });
    expect(html).toMatch(/<option[^>]*value="4"[^>]*selected/);
  });

  it("explains that an empty amount means no coperto and that it applies from now on", () => {
    const html = render();
    expect(html).toContain("Lascia vuoto se non applichi il coperto.");
    expect(html).toContain("Si applica ai tavoli aperti da ora in poi.");
  });

  it("has a Salva button and shows an error", () => {
    const html = render({
      error: "Il coperto va da 0,01 a 100,00 € e ha bisogno della sua aliquota IVA.",
    });
    expect(html).toMatch(/<button[^>]*>Salva<\/button>/);
    expect(html).toContain("Il coperto va da 0,01");
  });
});
