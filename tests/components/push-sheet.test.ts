// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushSheet } from "@/app/(owner)/spingere/push-sheet";

afterEach(cleanup);

const open = (props: Partial<Parameters<typeof PushSheet>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    createElement(PushSheet, {
      plateName: "Spezzatino con polenta",
      menuPrice: 14,
      busy: false,
      error: null,
      onConfirm,
      onCancel,
      ...props,
    }),
  );
  return { onConfirm, onCancel };
};

describe("PushSheet", () => {
  it("names the plate and the menu price", () => {
    open();
    expect(screen.getByRole("group", { name: "Spezzatino con polenta" })).toBeTruthy();
    expect(screen.getByText(/Prezzo del menu: 14,00\s+€/)).toBeTruthy();
  });

  it("works without a known menu price (no price line)", () => {
    open({ menuPrice: null });
    expect(screen.queryByText(/Prezzo del menu/)).toBeNull();
  });

  it.each([
    ["12,50", 12.5],
    ["12.5", 12.5],
    ["1.234,50", 1234.5],
    ["  9 ", 9],
    ["", null],
  ])("'%s' confirms %s", (typed, price) => {
    const { onConfirm } = open();
    fireEvent.change(screen.getByLabelText(/Prezzo del giorno/), { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(price);
  });

  it.each(["abc", "12,345", "-3", "0", "1,2,3"])("'%s' is refused without confirming", (typed) => {
    const { onConfirm } = open();
    fireEvent.change(screen.getByLabelText(/Prezzo del giorno/), { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/non è valido/)).toBeTruthy();
  });

  it("'Annulla' cancels", () => {
    const { onCancel, onConfirm } = open();
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a busy sheet cannot confirm twice", () => {
    open({ busy: true });
    expect((screen.getByRole("button", { name: "Conferma" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows the server's error in an aria-live region", () => {
    open({ error: "Il prezzo del giorno non può superare il prezzo del menu (14,00 €)." });
    const message = screen.getByText(/non può superare/);
    expect(message.closest("[aria-live]")).not.toBeNull();
  });
});
