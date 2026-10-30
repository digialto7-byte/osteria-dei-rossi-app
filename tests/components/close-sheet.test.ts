// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloseSheet } from "@/app/(owner)/tavoli/comanda/close-sheet";
import { EMPTY_CLOSE_FORM } from "@/lib/bill/close-form";

afterEach(cleanup);
type Props = Parameters<typeof CloseSheet>[0];
const FILLED = {
  receiptType: "scontrino",
  receiptNumber: "0012-0034",
  paymentType: "card",
} as const;
const base: Props = {
  total: 100,
  form: EMPTY_CLOSE_FORM,
  onForm: () => undefined,
  block: null,
  queuedCount: 0,
  busy: false,
  error: null,
  onSubmit: () => undefined,
  onCancel: () => undefined,
};
const show = (over: Partial<Props> = {}) => render(createElement(CloseSheet, { ...base, ...over }));
const submit = () =>
  screen.getByRole("button", { name: /^Chiudi (tavolo|senza numero)$/ }) as HTMLButtonElement;

describe("CloseSheet", () => {
  it("marks its section so an E2E spec can scope to it", () => {
    show();
    const sheet = document.querySelector("[data-close-sheet]") as HTMLElement;
    expect(sheet.contains(submit())).toBe(true);
  });

  it("shows the total to close", () => {
    show();
    expect(screen.getByText(/^Totale\s+100,00\s+€$/)).toBeTruthy();
  });

  it("offers the documents and the payments as radios, none chosen", () => {
    show();
    for (const name of ["Scontrino", "Fattura", "Contanti", "Carta", "Altro"]) {
      const radio = screen.getByRole("radio", { name }) as HTMLInputElement;
      expect(radio.checked).toBe(false);
    }
    expect(screen.getByRole("radiogroup", { name: "Documento" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Pagamento" })).toBeTruthy();
  });

  it("checks the chosen options", () => {
    show({ form: FILLED });
    expect((screen.getByRole("radio", { name: "Scontrino" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: "Carta" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Fattura" }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("choosing a radio asks the page for the new form", () => {
    const onForm = vi.fn();
    show({ onForm });
    fireEvent.click(screen.getByRole("radio", { name: "Fattura" }));
    fireEvent.click(screen.getByRole("radio", { name: "Altro" }));
    expect(onForm.mock.calls).toEqual([
      [{ ...EMPTY_CLOSE_FORM, receiptType: "fattura" }],
      [{ ...EMPTY_CLOSE_FORM, paymentType: "other" }],
    ]);
  });

  it("has a labelled number field for the printed number (text, upper case, 20 characters)", () => {
    show();
    const field = screen.getByLabelText(/^Numero/) as HTMLInputElement;
    expect(field.getAttribute("inputmode")).toBe("text");
    expect(field.getAttribute("autocapitalize")).toBe("characters");
    expect(field.maxLength).toBe(20);
    expect(screen.getByText("Il numero stampato dal registratore")).toBeTruthy();
  });

  it("typing a number asks the page for the new form", () => {
    const onForm = vi.fn();
    show({ onForm });
    fireEvent.change(screen.getByLabelText(/^Numero/), { target: { value: "0012-0034" } });
    expect(onForm).toHaveBeenCalledWith({ ...EMPTY_CLOSE_FORM, receiptNumber: "0012-0034" });
  });

  it("with no number the button says 'Chiudi senza numero' and a warning explains the flag", () => {
    show({ form: { ...FILLED, receiptNumber: "" } });
    expect(submit().textContent).toBe("Chiudi senza numero");
    expect(screen.getByText("Il tavolo sarà segnalato nella chiusura di cassa.")).toBeTruthy();
  });

  it("with a number the button says 'Chiudi tavolo' and there is no warning", () => {
    show({ form: FILLED });
    expect(submit().textContent).toBe("Chiudi tavolo");
    expect(screen.queryByText("Il tavolo sarà segnalato nella chiusura di cassa.")).toBeNull();
  });

  it("is disabled until a document and a payment are chosen", () => {
    show();
    expect(submit().disabled).toBe(true);
    cleanup();
    show({ form: { ...EMPTY_CLOSE_FORM, receiptType: "scontrino" } });
    expect(submit().disabled).toBe(true);
    cleanup();
    show({ form: FILLED });
    expect(submit().disabled).toBe(false);
  });

  it("is disabled offline, with the reason", () => {
    show({ form: FILLED, block: "offline" });
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Serve la connessione per chiudere il tavolo.")).toBeTruthy();
  });

  it("is disabled while orders of this table are queued on the phone, with the count", () => {
    show({ form: FILLED, block: "queued", queuedCount: 3 });
    expect(submit().disabled).toBe(true);
    expect(
      screen.getByText(
        "Ci sono 3 operazioni di questo tavolo ancora in coda su questo telefono: attendi l'invio.",
      ),
    ).toBeTruthy();
  });

  it("is disabled while busy and sends on a click", () => {
    const onSubmit = vi.fn();
    show({ form: FILLED, onSubmit });
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    cleanup();
    show({ form: FILLED, busy: true });
    expect(submit().disabled).toBe(true);
  });

  it("cancels", () => {
    const onCancel = vi.fn();
    show({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows an error as an alert", () => {
    show({ error: "Il conto è cambiato: controlla il nuovo totale." });
    expect(screen.getByRole("alert").textContent).toBe(
      "Il conto è cambiato: controlla il nuovo totale.",
    );
  });

  it("every control is at least 44 px (min-h-tap)", () => {
    const { container } = show({ form: FILLED });
    for (const control of container.querySelectorAll("button")) {
      expect(control.className, control.textContent ?? "").toContain("min-h-tap");
    }
    for (const radio of container.querySelectorAll('input[type="radio"]')) {
      expect(radio.closest("label")?.className).toContain("min-h-tap");
    }
    expect(container.querySelector('input[type="text"]')?.className).toContain("min-h-tap");
  });
});
