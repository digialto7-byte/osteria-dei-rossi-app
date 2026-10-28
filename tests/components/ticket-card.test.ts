// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TicketCard } from "@/app/(owner)/cucina/ticket-card";
import { KIDS, KITCHEN_TICKETS } from "../helpers/kitchen-data";

afterEach(cleanup);
const [stew, soup] = KITCHEN_TICKETS.tickets;
const show = (ticket = stew!) => render(createElement(TicketCard, { ticket }));
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
