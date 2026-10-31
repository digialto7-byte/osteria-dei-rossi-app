// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TicketCard } from "@/app/(owner)/cucina/ticket-card";
import { KIDS, KITCHEN_TICKETS } from "../helpers/kitchen-data";

afterEach(cleanup);
const [stew, soup] = KITCHEN_TICKETS.tickets;
const show = (ticket = stew!, over: Record<string, unknown> = {}) =>
  render(
    createElement(TicketCard, {
      ticket,
      pending: new Set<string>(),
      blocked: false,
      onTapLine: () => undefined,
      onClose: () => undefined,
      ...over,
    }),
  );
const line = (id: string) => document.querySelector(`[data-line-id="${id}"]`) as HTMLElement;

describe("TicketCard", () => {
  it("is an article carrying the ticket key, with the table, covers, course and who sent it when", () => {
    const { container } = show();
    const article = container.querySelector("article")!;
    expect(article.getAttribute("data-ticket-key")).toBe(stew!.key);
    expect(within(article).getByText("Tavolo 1 (demo)")).toBeTruthy();
    expect(within(article).getByText("4 coperti")).toBeTruthy();
    expect(within(article).getByText("Secondi")).toBeTruthy();
    expect(within(article).getByText("20:31 · Cameriere Demo")).toBeTruthy();
    expect(within(article).queryByText("A seguire")).toBeNull();
  });

  it("marks a segue ticket with a badge", () => {
    show(soup!);
    expect(screen.getByText("A seguire")).toBeTruthy();
    expect(screen.getByText("Primi")).toBeTruthy();
  });

  it("lists the lines by id: quantity and name, the note, the sharing", () => {
    show();
    expect(within(line(KIDS.line1)).getByText("2 × Spezzatino con polenta (demo)")).toBeTruthy();
    expect(within(line(KIDS.line1)).getByText("senza cipolla")).toBeTruthy();
    expect(within(line(KIDS.line2)).getByText(/^½ × Zuppa del giorno \(demo\)/)).toBeTruthy();
    expect(within(line(KIDS.line2)).getByText("Da dividere")).toBeTruthy();
    expect(within(line(KIDS.line1)).queryByText("Da dividere")).toBeNull();
  });

  it("strikes a voided line through and says why in words", () => {
    show();
    const voided = line(KIDS.line2);
    expect(voided.querySelector(".line-through")).not.toBeNull();
    expect(within(voided).getByText("Stornato · Errore in cucina")).toBeTruthy();
    expect(line(KIDS.line1).querySelector(".line-through")).toBeNull();
  });

  it("renders a note as text, never as markup", () => {
    const ticket = {
      ...stew!,
      lines: [{ ...stew!.lines[0]!, note: "<script>alert(1)</script>" }],
    };
    const { container } = show(ticket);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  });

  it("shows no euro value", () => {
    const { container } = show();
    expect(container.textContent).not.toContain("€");
    expect(container.textContent).not.toMatch(/Costo|Prezzo|Totale/);
  });
});

describe("TicketCard, done marks (M19b)", () => {
  const five = {
    ...stew!,
    lineCount: 5,
    doneCount: 2,
    lines: [
      ...stew!.lines,
      { ...stew!.lines[0]!, id: "10000000-0000-4000-8000-0000000000a1", name: "Polenta (demo)" },
      {
        ...stew!.lines[0]!,
        id: "10000000-0000-4000-8000-0000000000a2",
        name: "Pane (demo)",
        done: true,
      },
    ],
  };

  it("says how many dishes are done, from the numbers it is given", () => {
    const { container } = show(five);
    const count = container.querySelector("[data-done-count]")!;
    expect(count.textContent).toBe("2 di 5 fatti");
    expect(count.getAttribute("data-done-count")).toBe("2");
  });

  it("renders the lines in the order it gets them, by id", () => {
    const { container } = show(five);
    const ids = [...container.querySelectorAll("[data-line-id]")].map((n) =>
      n.getAttribute("data-line-id"),
    );
    expect(ids).toEqual(five.lines.map((l) => l.id));
  });

  it("has a Chiudi comanda button with its accessible name and a 44 px target", () => {
    show();
    const close = screen.getByRole("button", { name: "Chiudi comanda: Tavolo 1 (demo), Secondi" });
    expect(close.className).toContain("min-h-tap");
    expect(close.textContent).toBe("Chiudi comanda");
  });

  it("closing and tapping a dish call back with the comanda and the line", () => {
    const onClose = vi.fn();
    const onTapLine = vi.fn();
    show(stew!, { onClose, onTapLine });
    fireEvent.click(
      screen.getByRole("button", { name: "Chiudi comanda: Tavolo 1 (demo), Secondi" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Segna fatto: 2 × Spezzatino/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]![0]).toBe(stew);
    expect(onTapLine).toHaveBeenCalledTimes(1);
    expect(onTapLine.mock.calls[0]![0]).toBe(stew);
    expect((onTapLine.mock.calls[0]![1] as { id: string }).id).toBe(KIDS.line1);
  });

  it("blocked: every button is disabled", () => {
    show(stew!, { blocked: true });
    for (const button of screen.getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("a pending comanda disables its close button", () => {
    show(stew!, { pending: new Set([stew!.key]) });
    const close = screen.getByRole("button", { name: /^Chiudi comanda/ }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
  });

  it("shows no euro value with the new controls either", () => {
    const { container } = show(five);
    expect(container.textContent).not.toContain("€");
  });
});
