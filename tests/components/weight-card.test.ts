// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeightCard } from "@/app/(owner)/tavoli/impostazioni/weight-card";
import { WEIGHT_SETTINGS } from "../helpers/menu-tables-data";

type Props = Parameters<typeof WeightCard>[0];
const show = (over: Partial<Props> = {}) => {
  const onSave = vi.fn();
  render(
    createElement(WeightCard, {
      settings: WEIGHT_SETTINGS,
      busy: false,
      error: null,
      onSave,
      ...over,
    }),
  );
  return onSave;
};
const plain = (text: string | null) => (text ?? "").replaceAll(" ", " ");
afterEach(cleanup);

describe("WeightCard", () => {
  it("is a named group with the maximum in force and the default", () => {
    show();
    expect(screen.getByRole("group", { name: "Peso massimo per riga" })).toBeTruthy();
    expect((screen.getByLabelText(/^Peso massimo per riga \(g\)/) as HTMLInputElement).value).toBe(
      "3000",
    );
    expect(plain(screen.getByRole("group").textContent)).toContain("predefinito 3.000 g");
  });

  it("the field is numeric and takes its range and step from the reply", () => {
    show({ settings: { ...WEIGHT_SETTINGS, weightMaxG: 4000 } });
    const field = screen.getByLabelText(/^Peso massimo per riga \(g\)/) as HTMLInputElement;
    expect(field.value).toBe("4000");
    expect(field.getAttribute("inputmode")).toBe("numeric");
    expect(plain(screen.getByRole("group").textContent)).toContain("da 500 a 10.000 g");
  });

  it("the step in the hint is the reply's stepG, not a literal", () => {
    show({ settings: { ...WEIGHT_SETTINGS, stepG: 50 } });
    const text = plain(screen.getByRole("group").textContent);
    expect(text).toContain("a passi di 50");
    expect(text).not.toContain("a passi di 10");
  });

  it("saving 4000 sends exactly {weightMaxG: 4000}", () => {
    const onSave = show();
    fireEvent.change(screen.getByLabelText(/^Peso massimo per riga \(g\)/), {
      target: { value: "4000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ weightMaxG: 4000 });
  });

  it("a value off the step or outside the range is refused in the card, nothing sent", () => {
    const onSave = show();
    fireEvent.change(screen.getByLabelText(/^Peso massimo per riga \(g\)/), {
      target: { value: "1005" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Il peso massimo per riga va da 500 a 10.000 g, a passi di 10.",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Ripristina sends {weightMaxG: null}", () => {
    const onSave = show({ settings: { ...WEIGHT_SETTINGS, weightMaxG: 4000 } });
    fireEvent.click(screen.getByRole("button", { name: "Ripristina" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ weightMaxG: null });
  });

  it("shows the server's 422 message in an alert", () => {
    show({ error: "Il peso massimo per riga va da 500 a 10.000 g, a passi di 10." });
    expect(screen.getByRole("alert").textContent).toContain("va da 500 a 10.000 g");
  });

  it("disables the controls while saving", () => {
    show({ busy: true });
    expect((screen.getByRole("button", { name: "Salva" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Ripristina" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
