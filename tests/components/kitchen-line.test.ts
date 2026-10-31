// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KitchenLine } from "@/app/(owner)/cucina/kitchen-line";
import { KITCHEN_TICKETS } from "../helpers/kitchen-data";

afterEach(cleanup);
const [stew] = KITCHEN_TICKETS.tickets;
const open = stew!.lines[0]!;
const voided = stew!.lines[1]!;
const done = { ...open, done: true };
const show = (line = open, over: Record<string, unknown> = {}) =>
  render(
    createElement(
      "ul",
      null,
      createElement(KitchenLine, {
        line,
        pending: false,
        blocked: false,
        onTap: () => undefined,
        ...over,
      }),
    ),
  );
const row = () => document.querySelector(`[data-line-id="${open.id}"]`) as HTMLElement;

describe("KitchenLine", () => {
  it("an open dish is a button, not pressed, named by what a tap does", () => {
    show();
    const button = screen.getByRole("button", {
      name: "Segna fatto: 2 × Spezzatino con polenta (demo)",
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.className).toContain("min-h-tap");
    expect(button.querySelector(".line-through")).toBeNull();
    expect(within(row()).queryByText("Fatto")).toBeNull();
  });

  it("shows the note and the sharing inside the row", () => {
    show();
    expect(within(row()).getByText("senza cipolla")).toBeTruthy();
    show({ ...open, isShared: true });
    expect(screen.getAllByText("Da dividere").length).toBeGreaterThan(0);
  });

  it("a done dish is pressed, struck, and says Fatto in words", () => {
    show(done);
    const button = screen.getByRole("button", {
      name: "Annulla fatto: 2 × Spezzatino con polenta (demo)",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.querySelector(".line-through")).not.toBeNull();
    expect(within(button).getByText("Fatto")).toBeTruthy();
  });

  it("a pending dish is busy and ignores taps", () => {
    const onTap = vi.fn();
    show(open, { pending: true, onTap });
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("a voided dish is not a button; it is struck and says why", () => {
    show(voided);
    expect(screen.queryByRole("button")).toBeNull();
    const item = document.querySelector(`[data-line-id="${voided.id}"]`) as HTMLElement;
    expect(item.querySelector(".line-through")).not.toBeNull();
    expect(within(item).getByText("Stornato · Errore in cucina")).toBeTruthy();
  });

  it("blocked: the button is disabled and a tap does nothing", () => {
    const onTap = vi.fn();
    show(open, { blocked: true, onTap });
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("a tap calls back once", () => {
    const onTap = vi.fn();
    show(open, { onTap });
    fireEvent.click(screen.getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("renders a note as text, never as markup", () => {
    const { container } = show({ ...open, note: "<script>alert(1)</script>" });
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  });
});
