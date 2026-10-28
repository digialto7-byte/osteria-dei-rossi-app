// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SendButtons } from "@/app/(owner)/tavoli/[sessionId]/send-buttons";
import type { FireGroup } from "@/lib/orders/fire-view";

afterEach(cleanup);
const A = "20000000-0000-4000-8000-00000000000a";
const B = "20000000-0000-4000-8000-00000000000b";
const C = "20000000-0000-4000-8000-00000000000c";

const group = (over: Partial<FireGroup> = {}): FireGroup => ({
  course: "primi",
  normalIds: [A, B],
  segueIds: [C],
  blocked: false,
  ...over,
});
type Props = Parameters<typeof SendButtons>[0];
const show = (over: Partial<Props> = {}) =>
  render(
    createElement(SendButtons, { group: group(), sending: null, onSend: () => undefined, ...over }),
  );

describe("SendButtons", () => {
  it("shows 'Invia primi · 2' and 'Invia a seguire · 1' with their accessible names", () => {
    show();
    expect(screen.getByText("Invia primi · 2")).toBeTruthy();
    expect(screen.getByText("Invia a seguire · 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invia in cucina: Primi, 2 piatti" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Invia in cucina: Primi a seguire, 1 piatto" }),
    ).toBeTruthy();
  });

  it("each button sends exactly the ids of its group", () => {
    const onSend = vi.fn();
    show({ onSend });
    fireEvent.click(screen.getByRole("button", { name: "Invia in cucina: Primi, 2 piatti" }));
    expect(onSend).toHaveBeenLastCalledWith([A, B]);
    fireEvent.click(screen.getByRole("button", { name: /a seguire/ }));
    expect(onSend).toHaveBeenLastCalledWith([C]);
  });

  it("every button is at least 44 px tall", () => {
    show();
    for (const button of screen.getAllByRole("button"))
      expect(button.className).toContain("min-h-tap");
  });

  it("has no button for a group without a draft", () => {
    const { container } = show({ group: group({ normalIds: [], segueIds: [] }) });
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows only the button that has lines", () => {
    show({ group: group({ segueIds: [] }) });
    expect(screen.getByText("Invia primi · 2")).toBeTruthy();
    expect(screen.queryByText(/a seguire/)).toBeNull();
    cleanup();
    show({ group: group({ normalIds: [] }) });
    expect(screen.queryByText(/Invia primi/)).toBeNull();
    expect(screen.getByText("Invia a seguire · 1")).toBeTruthy();
  });

  it("waits while a line of the course is still being sent: disabled, with the reason", () => {
    const onSend = vi.fn();
    show({ group: group({ blocked: true }), onSend });
    for (const button of screen.getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Attendi l'invio delle righe")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("says the reason even when the only draft is the unconfirmed one", () => {
    show({ group: group({ normalIds: [], segueIds: [], blocked: true }) });
    expect(screen.getByText("Attendi l'invio delle righe")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("while sending, the pressed button says 'Invio…' and both are off", () => {
    show({ sending: "segue" });
    expect(screen.getByText("Invio…")).toBeTruthy();
    expect(screen.getByText("Invia primi · 2")).toBeTruthy();
    for (const button of screen.getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("while another course is being sent both buttons are off and keep their words", () => {
    show({ locked: true });
    expect(screen.getByText("Invia primi \u00b7 2")).toBeTruthy();
    expect(screen.queryByText("Invio\u2026")).toBeNull();
    for (const button of screen.getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows no euro value", () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/€|Costo|Margine/);
  });
});
