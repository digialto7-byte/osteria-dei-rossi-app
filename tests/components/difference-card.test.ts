// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DifferenceCard } from "@/app/(owner)/chiusura/difference-card";
import { REPORT, REPORT_NO_REGISTER } from "../helpers/bill-data";

afterEach(cleanup);
type Props = Parameters<typeof DifferenceCard>[0];
const show = (over: Partial<Props> = {}) =>
  render(
    createElement(DifferenceCard, {
      register: REPORT.register,
      difference: REPORT.difference,
      ...over,
    }),
  );
const text = (container: HTMLElement) => container.textContent ?? "";
const MINUS = String.fromCharCode(0x2212);
const nb = (s: string) => s.replace(/(\d) (€|%)/g, "$1" + String.fromCharCode(160) + "$2");
// getByText normalises the no-break space away, so amounts are matched on the element's exact text instead.
const byText = (expected: string) =>
  screen.getByText(
    (_content, element) => element?.textContent === expected && element.children.length === 0,
  );

describe("DifferenceCard", () => {
  it("shows the signed difference with its percentage and the sentence (app minus register)", () => {
    const { container } = show();
    expect(text(container)).toContain(nb("+12,50 € (+1,0 %)"));
    expect(byText(nb("L'app registra 12,50 € in più della cassa"))).toBeTruthy();
  });

  it("uses the real minus sign and says 'in meno' when the app is short", () => {
    const { container } = show({ difference: { amount: -5.5, pct: -0.4 } });
    expect(text(container)).toContain(nb(`${MINUS}5,50 € (${MINUS}0,4 %)`));
    expect(text(container)).not.toContain("-5,50");
    expect(byText(nb("L'app registra 5,50 € in meno della cassa"))).toBeTruthy();
  });

  it("says they match at zero", () => {
    show({ difference: { amount: 0, pct: 0 } });
    expect(screen.getByText("App e cassa coincidono")).toBeTruthy();
  });

  it("leaves out the percentage when the register total was 0", () => {
    const { container } = show({ difference: { amount: 50, pct: null } });
    expect(text(container)).toContain(nb("+50,00 €"));
    expect(text(container)).not.toContain("%");
  });

  it("says who entered the total and when (Europe/Rome)", () => {
    show();
    expect(screen.getByText("Inserito da Titolare Demo alle 23:25")).toBeTruthy();
  });

  it("says how many entries when the total was corrected", () => {
    show({ register: { ...REPORT.register!, entries: 2 } });
    expect(screen.getByText("2 inserimenti")).toBeTruthy();
  });

  it("does not mention entries when there is one", () => {
    show();
    expect(screen.queryByText(/inserimento|inserimenti/)).toBeNull();
  });

  it("without a register entry it only asks for the total", () => {
    const { container } = show({
      register: REPORT_NO_REGISTER.register,
      difference: REPORT_NO_REGISTER.difference,
    });
    expect(
      screen.getByText("Inserisci il totale della cassa per vedere la differenza"),
    ).toBeTruthy();
    expect(text(container)).not.toMatch(/Inserito da|L'app registra|€/);
  });

  it("the tone is a reinforcement: the sentence is always there", () => {
    const { container } = show({ difference: { amount: -1, pct: -0.1 } });
    expect(container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("under");
    expect(screen.getByText(/in meno della cassa/)).toBeTruthy();
  });
});
