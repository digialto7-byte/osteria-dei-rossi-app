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

  it("offers 'Conto e chiusura', a link to the table's bill tab (M21)", () => {
    render(createElement(SessionPanel, props(OPEN)));
    const link = screen.getByRole("link", { name: "Conto e chiusura" });
    expect(link.getAttribute("href")).toBe(`/tavoli/comanda?s=${OPEN.session!.id}&vista=conto`);
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

  // QW11: the comanda link is the one primary control of the panel; "Conto richiesto" is a pressed secondary toggle, never a second primary.
  describe("one primary control (QW11)", () => {
    const primaries = (container: HTMLElement) =>
      [...container.querySelectorAll("a, button")].filter((el) =>
        el.className.split(/\s+/).includes("bg-accent"),
      );

    it.each([
      ["off", OPEN],
      ["on", BILL],
    ] as const)(
      "has exactly one bg-accent element, the comanda link, with the toggle %s",
      (_state, table) => {
        const { container } = render(createElement(SessionPanel, props(table)));
        const found = primaries(container);
        expect(found).toHaveLength(1);
        expect(found[0]!.textContent).toBe("Prendi la comanda");
      },
    );

    it("when on, the toggle is pressed, sunk and shows a check mark that the accessible name ignores", () => {
      render(createElement(SessionPanel, props(BILL)));
      const toggle = screen.getByRole("button", { name: "Conto richiesto" });
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(toggle.getAttribute("data-on")).toBe("true");
      expect(toggle.className).toContain("data-[on=true]:bg-sunk");
      expect(toggle.className).toContain("border-ink");
      const mark = toggle.querySelector('[aria-hidden="true"]');
      expect(mark?.textContent).toBe("✓");
    });

    it("when off, the toggle has no check mark and is not marked on", () => {
      render(createElement(SessionPanel, props(OPEN)));
      const toggle = screen.getByRole("button", { name: "Conto richiesto" });
      expect(toggle.getAttribute("data-on")).toBe("false");
      expect(toggle.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(toggle.textContent).toBe("Conto richiesto");
    });
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

describe("SessionPanel offline (M20, Q123 default)", () => {
  it("covers and 'Conto richiesto' are off with 'Serve la connessione' while the phone is offline", () => {
    render(createElement(SessionPanel, { ...props(OPEN), offline: true }));
    expect(
      (screen.getByRole("button", { name: "Modifica coperti" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Conto richiesto" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Serve la connessione")).toBeTruthy();
  });

  it("online they work and the hint is not there", () => {
    render(createElement(SessionPanel, { ...props(OPEN), offline: false }));
    expect(
      (screen.getByRole("button", { name: "Modifica coperti" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Conto richiesto" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("Serve la connessione")).toBeNull();
  });

  it("'Prendi la comanda' stays available offline (it is a link to the cached comanda)", () => {
    render(createElement(SessionPanel, { ...props(OPEN), offline: true }));
    expect(screen.getByRole("link", { name: "Prendi la comanda" })).toBeTruthy();
  });
});
