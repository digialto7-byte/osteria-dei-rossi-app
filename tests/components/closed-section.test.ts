// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClosedSection } from "@/app/(owner)/cucina/closed-section";
import { KIDS, KITCHEN_TICKETS } from "../helpers/kitchen-data";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);
const [auto, tap] = KITCHEN_TICKETS.closedTickets;
const show = (over: Record<string, unknown> = {}) =>
  render(
    createElement(ClosedSection, {
      tickets: KITCHEN_TICKETS.closedTickets,
      pending: new Set<string>(),
      blocked: false,
      onReopen: () => undefined,
      ...over,
    }),
  );
const toggle = () => screen.getByRole("button", { name: "Chiuse oggi (2)" });

describe("ClosedSection", () => {
  it("is collapsed by default: a toggle with aria-expanded false and no card", () => {
    const { container } = show();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().className).toContain("min-h-tap");
    expect(container.querySelector("article")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Riapri/ })).toBeNull();
  });

  it("expands on a tap and remembers it on this device", () => {
    show();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(window.localStorage.getItem("kitchen.closedOpen")).toBe("true");
  });

  it("expanded: each comanda says when it closed, and who closed it by hand", () => {
    show();
    fireEvent.click(toggle());
    const autoCard = document.querySelector(`[data-ticket-key="${auto!.key}"]`) as HTMLElement;
    const tapCard = document.querySelector(`[data-ticket-key="${tap!.key}"]`) as HTMLElement;
    expect(within(autoCard).getByText("Tutto fatto alle 20:41")).toBeTruthy();
    expect(within(tapCard).getByText("Chiusa alle 20:38 · Chef Demo")).toBeTruthy();
    expect(within(autoCard).getByText("2 di 2 fatti")).toBeTruthy();
    expect(within(tapCard).getByText("0 di 1 fatti")).toBeTruthy();
  });

  it("expanded: a Riapri button per comanda and no dish button", () => {
    show();
    fireEvent.click(toggle());
    expect(screen.getAllByRole("button", { name: /^Riapri comanda/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Segna fatto|^Annulla fatto/ })).toBeNull();
    const line = document.querySelector(`[data-line-id="${KIDS.line4}"]`) as HTMLElement;
    expect(line.querySelector(".line-through")).not.toBeNull();
  });

  it("Riapri calls back with the comanda it belongs to", () => {
    const onReopen = vi.fn();
    show({ onReopen });
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Riapri comanda: Tavolo 3 (demo), Primi" }));
    expect(onReopen).toHaveBeenCalledTimes(1);
    expect(onReopen.mock.calls[0]![0]).toBe(tap);
    expect(
      screen.getByRole("button", { name: "Riapri comanda: Tavolo 3 (demo), Primi" }).className,
    ).toContain("min-h-tap");
  });

  it("blocked or pending: Riapri is disabled", () => {
    show({ blocked: true });
    fireEvent.click(toggle());
    for (const b of screen.getAllByRole("button", { name: /^Riapri/ }))
      expect((b as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    window.localStorage.clear();
    show({ pending: new Set([tap!.key]) });
    fireEvent.click(toggle());
    const buttons = screen.getAllByRole("button", { name: /^Riapri/ }) as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
  });

  it("starts expanded when this device remembered it", () => {
    window.localStorage.setItem("kitchen.closedOpen", "true");
    show();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("renders nothing when no comanda is closed", () => {
    const { container } = show({ tickets: [] });
    expect(container.innerHTML).toBe("");
  });

  it("shows no euro value", () => {
    const { container } = show();
    fireEvent.click(toggle());
    expect(container.textContent).not.toContain("€");
  });
});

describe("the new components do no arithmetic over ticket data", () => {
  it("their sources have no reduce and no length over tickets or lines", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const name of [
      "kitchen-line",
      "closed-section",
      "undo-notice",
      "remaining-count",
      "ticket-card",
    ]) {
      const source = readFileSync(
        join(process.cwd(), "src/app/(owner)/cucina", `${name}.tsx`),
        "utf8",
      );
      expect(source, name).not.toMatch(/\.reduce\(/);
      expect(source, name).not.toMatch(/(tickets|lines|ticket\.lines)\.length/);
    }
  });
});
