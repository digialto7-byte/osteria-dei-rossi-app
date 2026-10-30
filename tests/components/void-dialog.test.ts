// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoidDialog } from "@/app/(owner)/tavoli/comanda/void-dialog";
import { LINE_STEW } from "../helpers/orders-data";

afterEach(cleanup);
type Props = Parameters<typeof VoidDialog>[0];
const show = (over: Partial<Props> = {}) =>
  render(
    createElement(VoidDialog, {
      line: { ...LINE_STEW, state: "fired" },
      busy: false,
      onConfirm: () => undefined,
      onCancel: () => undefined,
      ...over,
    }),
  );
const select = () => screen.getByRole("combobox", { name: /^Motivo/ }) as HTMLSelectElement;

describe("VoidDialog", () => {
  it("has a 'Motivo' select wrapped in its label with the six reasons in order and none chosen", () => {
    show();
    const options = within(select()).getAllByRole("option");
    expect(options.slice(1).map((o) => o.textContent)).toEqual([
      "Errore di comanda",
      "Il cliente ha cambiato idea",
      "Errore in cucina",
      "Rimandato indietro",
      "Offerto dalla casa",
      "Caduto o rotto",
    ]);
    expect(options.slice(1).map((o) => (o as HTMLOptionElement).value)).toEqual([
      "order_error",
      "customer_changed",
      "kitchen_error",
      "returned",
      "comp",
      "breakage",
    ]);
    expect(select().value).toBe("");
    expect(options[0]!.textContent).toBe("Scegli un motivo");
  });

  it("'Storna piatto' is off until a reason is chosen, then sends that reason", () => {
    const onConfirm = vi.fn();
    show({ onConfirm });
    const button = screen.getByRole("button", { name: "Storna piatto" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(select(), { target: { value: "kitchen_error" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith("kitchen_error");
  });

  it("'Annulla' closes without sending", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    show({ onCancel, onConfirm });
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("says that the dish stays out of stock and counts as waste, without any figure", () => {
    const { container } = show();
    expect(
      screen.getByText("Il piatto resta scaricato dal magazzino e conta come scarto."),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/€|Costo|Margine/);
  });

  it("every control is at least 44 px tall and busy turns them off", () => {
    show({ busy: true });
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("min-h-tap");
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(select().disabled).toBe(true);
  });
});
