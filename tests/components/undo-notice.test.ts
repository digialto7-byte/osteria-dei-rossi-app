// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoNotice } from "@/app/(owner)/cucina/undo-notice";

afterEach(cleanup);
const undo = {
  text: "Tavolo 1 (demo) · Primi: comanda chiusa",
  path: "/api/kitchen/tickets/mark",
  body: { done: false } as const,
};
const show = (over: Record<string, unknown> = {}) =>
  render(createElement(UndoNotice, { undo, onUndo: () => undefined, disabled: false, ...over }));

describe("UndoNotice", () => {
  it("is a status with the text and an Annulla button of 44 px", () => {
    show();
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Tavolo 1 (demo) · Primi: comanda chiusa");
    const button = screen.getByRole("button", { name: "Annulla" });
    expect(button.className).toContain("min-h-tap");
  });

  it("calls back when Annulla is pressed", () => {
    const onUndo = vi.fn();
    show({ onUndo });
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a notice", () => {
    const { container } = show({ undo: null });
    expect(container.innerHTML).toBe("");
  });

  it("disabled: Annulla cannot be pressed", () => {
    const onUndo = vi.fn();
    show({ disabled: true, onUndo });
    const button = screen.getByRole("button", { name: "Annulla" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("has no dialog role and no euro sign", () => {
    const { container } = show();
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(container.textContent).not.toContain("€");
  });
});
