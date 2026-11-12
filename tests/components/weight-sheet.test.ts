// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeightSheet } from "@/app/(owner)/tavoli/comanda/weight-sheet";

afterEach(cleanup);
type Props = Parameters<typeof WeightSheet>[0];
const show = (over: Partial<Props> = {}) => {
  const props = {
    name: "Bistecca a peso (demo)",
    weightMaxG: 3000,
    portionWeightG: 400,
    initialWeightG: null,
    mode: "add" as const,
    busy: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(createElement(WeightSheet, props));
  return props;
};
const field = () => screen.getByLabelText(/^Peso \(g\)/) as HTMLInputElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const add = () => screen.getByRole("button", { name: "Aggiungi" }) as HTMLButtonElement;
const plain = (text: string | null) => (text ?? "").replaceAll(" ", " ");

describe("WeightSheet", () => {
  it("is a dialog named after the dish, with one numeric field focused first", () => {
    show();
    expect(screen.getByRole("dialog", { name: /Bistecca a peso \(demo\)/ })).toBeTruthy();
    expect(field().getAttribute("inputmode")).toBe("numeric");
    expect(field().getAttribute("step")).toBe("10");
    expect(document.activeElement).toBe(field());
  });

  it("Aggiungi is disabled until the weight is 50 g or more, on the 10 g step, within the maximum", () => {
    show();
    expect(add().disabled).toBe(true);
    for (const bad of ["40", "3010", "1205", "abc", "12,5"]) {
      type(bad);
      expect(add().disabled, bad).toBe(true);
    }
    for (const good of ["50", "1200", "3000"]) {
      type(good);
      expect(add().disabled, good).toBe(false);
    }
  });

  it("the maximum is the menu's: 3 500 is allowed with 4 000, refused with 3 000", () => {
    show({ weightMaxG: 4000 });
    type("3500");
    expect(add().disabled).toBe(false);
    cleanup();
    show({ weightMaxG: 3000 });
    type("3500");
    expect(add().disabled).toBe(true);
  });

  it("says the allowed range in words", () => {
    show();
    expect(plain(document.body.textContent)).toContain("da 50 g a 3.000 g, a passi di 10 g");
  });

  it("shows a live readout in kilograms", () => {
    show();
    type("1200");
    expect(plain(screen.getByTestId("weight-readout").textContent)).toBe("= 1,2 kg");
    type("250");
    expect(plain(screen.getByTestId("weight-readout").textContent)).toBe("= 250 g");
  });

  it("a weight under 3 times the portion is added at once", () => {
    const { onConfirm } = show();
    type("1190");
    fireEvent.click(add());
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(1190);
    expect(screen.queryByText(/Confermi/)).toBeNull();
  });

  it("a weight of 3 times the portion or more asks 'Confermi 1.200 g?' first", () => {
    const { onConfirm } = show();
    type("1200");
    fireEvent.click(add());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(plain(screen.getByText(/Confermi/).textContent)).toBe("Confermi 1.200 g?");
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(1200);
  });

  it("'Cambia' goes back to the field without sending", () => {
    const { onConfirm } = show();
    type("1500");
    fireEvent.click(add());
    fireEvent.click(screen.getByRole("button", { name: "Cambia" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText(/Confermi/)).toBeNull();
    expect(field().value).toBe("1500");
  });

  it("with no reference portion known there is no confirmation", () => {
    const { onConfirm } = show({ portionWeightG: null });
    type("3000");
    fireEvent.click(add());
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(3000);
  });

  it("editing starts from the line's weight and says Salva", () => {
    const { onConfirm } = show({ mode: "edit", initialWeightG: 1230, portionWeightG: 1000 });
    expect(field().value).toBe("1230");
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(1230);
  });

  it("Annulla closes it", () => {
    const { onCancel } = show();
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Enter in the field adds when the weight is valid", () => {
    const { onConfirm } = show();
    type("300");
    fireEvent.submit(field().closest("form")!);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(300);
  });
});
