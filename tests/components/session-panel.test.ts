// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionPanel } from "@/app/(owner)/tavoli/session-panel";
import type { TableTile } from "@/server/tables/output";
import { TABLES_LIST } from "../helpers/menu-tables-data";

const OPEN = TABLES_LIST.tables[0]!;
const BILL = TABLES_LIST.tables[2]!;
type Props = Parameters<typeof SessionPanel>[0];
const props = (table: TableTile, over: Partial<Props> = {}): Props => ({
  table,
  busy: false,
  error: null,
  onChangeCovers: () => undefined,
  onToggleBill: () => undefined,
  onClose: () => undefined,
  ...over,
});
afterEach(cleanup);

describe("SessionPanel", () => {
  it("shows the covers, the opener and the coperto as the server computed it", () => {
    render(createElement(SessionPanel, props(OPEN)));
    expect(screen.getByText("4 coperti")).toBeTruthy();
    expect(screen.getByText("Cameriere Demo · 20:15")).toBeTruthy();
    expect(screen.getByText(/^Coperto 6,00\s€$/)).toBeTruthy();
  });

  it("offers 'Prendi la comanda', a link to the table's order screen", () => {
    render(createElement(SessionPanel, props(OPEN)));
    const link = screen.getByRole("link", { name: "Prendi la comanda" });
    expect(link.getAttribute("href")).toBe(`/tavoli/comanda?s=${OPEN.session!.id}`);
    expect(link.className).toContain("min-h-tap");
  });

  it("shows no coperto line when the table has none", () => {
    render(createElement(SessionPanel, props(BILL)));
    expect(screen.queryByText(/^Coperto/)).toBeNull();
  });

  it("Conto richiesto is a toggle button reflecting the session", () => {
    const { unmount } = render(createElement(SessionPanel, props(OPEN)));
    expect(
      screen.getByRole("button", { name: "Conto richiesto" }).getAttribute("aria-pressed"),
    ).toBe("false");
    unmount();
    render(createElement(SessionPanel, props(BILL)));
    expect(
      screen.getByRole("button", { name: "Conto richiesto" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("tapping it asks for the opposite of what the server holds", () => {
    const onToggleBill = vi.fn();
    render(createElement(SessionPanel, props(OPEN, { onToggleBill })));
    fireEvent.click(screen.getByRole("button", { name: "Conto richiesto" }));
    expect(onToggleBill).toHaveBeenCalledWith(true);
    cleanup();
    render(createElement(SessionPanel, props(BILL, { onToggleBill })));
    fireEvent.click(screen.getByRole("button", { name: "Conto richiesto" }));
    expect(onToggleBill).toHaveBeenLastCalledWith(false);
  });

  it("Modifica coperti opens the covers field; saving sends the new number", () => {
    const onChangeCovers = vi.fn();
    render(createElement(SessionPanel, props(OPEN, { onChangeCovers })));
    fireEvent.click(screen.getByRole("button", { name: "Modifica coperti" }));
    const field = screen.getByLabelText("Coperti") as HTMLInputElement;
    expect(field.value).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "Più un coperto" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva coperti" }));
    expect(onChangeCovers).toHaveBeenCalledWith(5);
  });

  it("refuses covers outside 1 to 99 on the panel", () => {
    const onChangeCovers = vi.fn();
    render(createElement(SessionPanel, props(OPEN, { onChangeCovers })));
    fireEvent.click(screen.getByRole("button", { name: "Modifica coperti" }));
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva coperti" }));
    expect(onChangeCovers).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("I coperti vanno da 1 a 99.");
  });

  it("shows the server's error and closes with Chiudi", () => {
    const onClose = vi.fn();
    render(createElement(SessionPanel, props(OPEN, { onClose, error: "Il tavolo è già chiuso." })));
    expect(screen.getByRole("alert").textContent).toBe("Il tavolo è già chiuso.");
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a table without a session", () => {
    const { container } = render(createElement(SessionPanel, props(TABLES_LIST.tables[1]!)));
    expect(container.innerHTML).toBe("");
  });
});
