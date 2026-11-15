// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableHeader } from "@/app/(owner)/tavoli/comanda/table-header";
import { sessionHeaderOf } from "@/lib/orders/session-header";

// The comanda's header (docs/plans/2026-11-14-ux-p2-design-system.md D15, D17; p3-sala-waiter.md §10.2-§10.3 with the lead's change): the table's
// name, the "Tavolo ▾" disclosure with "Modifica coperti", the status badge, the "Conto richiesto" toggle and the meta line. The cases of
// the session panel's test that still apply moved here (§5c).

type Props = Parameters<typeof TableHeader>[0];
const OPEN: Props["session"] = {
  tableName: "Tavolo 1 (demo)",
  covers: 4,
  status: "open",
  billRequested: false,
  closed: false,
};
const BILL: Props["session"] = { ...OPEN, status: "bill_requested", billRequested: true };
const props = (over: Partial<Props> = {}): Props => ({
  session: OPEN,
  meta: sessionHeaderOf({}),
  offline: false,
  onChangeCovers: vi.fn(() => Promise.resolve(null)),
  onToggleBill: vi.fn(() => Promise.resolve(null)),
  ...over,
});
const show = (over: Partial<Props> = {}) => render(createElement(TableHeader, props(over)));
const toggle = () => screen.getByRole("button", { name: "Conto richiesto" }) as HTMLButtonElement;
const more = () =>
  screen.getByRole("button", { name: "Tavolo: altre azioni" }) as HTMLButtonElement;
const card = () => screen.queryByRole("group", { name: "Modifica coperti" });
afterEach(cleanup);

describe("TableHeader rows", () => {
  it("shows the table as the h1, its status as a badge and, with no opener data, the covers only", () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 1, name: "Tavolo 1 (demo)" })).toBeTruthy();
    expect(screen.getByText("Aperto").getAttribute("data-tone")).toBe("success");
    // An unknown opener and coperto are left out, not replaced (D17).
    expect(screen.getByText("4 coperti").textContent).toBe("4 coperti");
    expect(container.textContent).not.toMatch(/Coperto|Cameriere| · /);
  });

  it("the meta line carries covers, opener, time and coperto in one line (P2b-10)", () => {
    const meta = sessionHeaderOf({
      openedBy: { displayName: "Giulia" },
      openedAt: "2026-11-02T19:14:00+00:00",
      openedToday: true,
      coperto: { perPerson: 2.5, vatRate: 10, total: 10 },
    });
    show({ meta });
    expect(document.querySelector("p.num")!.textContent!.replace(/\u00a0/g, " ")).toBe(
      "4 coperti · Giulia · 20:14 · Coperto 10,00 €",
    );
  });

  it("a table opened offline with an unreadable tap time still says 'Apertura in coda', with no time", () => {
    const meta = sessionHeaderOf({
      source: "queued",
      openedBy: { displayName: "Giulia" },
      queuedAt: "not a time",
    });
    show({ meta });
    expect(document.querySelector("p.num")!.textContent).toBe(
      "4 coperti · Giulia · Apertura in coda",
    );
  });

  it("a table opened offline says 'Apertura in coda' and has no coperto", () => {
    const meta = sessionHeaderOf({
      source: "queued",
      openedBy: { displayName: "Giulia" },
      queuedAt: new Date().toISOString(),
    });
    show({ meta });
    const text = document.querySelector("p.num")!.textContent!;
    expect(text).toMatch(/^4 coperti · Giulia · \d\d:\d\d · Apertura in coda$/);
    expect(text).not.toContain("Coperto");
  });

  it("has no primary control: the bar's 'Invia' is the one primary of the screen (QW11)", () => {
    const { container } = show();
    expect(container.querySelectorAll(".bg-accent")).toHaveLength(0);
  });
});

describe("TableHeader 'Conto richiesto' toggle", () => {
  it("is a pressed secondary that follows the session, with a check mark the name ignores", () => {
    const { unmount } = show();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().getAttribute("data-on")).toBe("false");
    expect(toggle().querySelector('[aria-hidden="true"]')).toBeNull();
    expect(toggle().textContent).toBe("Conto richiesto");
    unmount();
    show({ session: BILL });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().getAttribute("data-on")).toBe("true");
    expect(toggle().querySelector('[aria-hidden="true"]')?.textContent).toBe("✓");
    expect(toggle().className).toContain("data-[on=true]:bg-sunk");
    expect(toggle().className).toContain("border-ink");
    expect(toggle().className).not.toContain("bg-accent");
  });

  it("is at the header, not inside the 'Tavolo ▾' card (lead decision, one tap)", () => {
    show();
    fireEvent.click(more());
    expect(within(card()!).queryByRole("button", { name: "Conto richiesto" })).toBeNull();
    expect(toggle()).toBeTruthy();
  });

  it("asks for the opposite of what the session holds", () => {
    const onToggleBill = vi.fn(() => Promise.resolve(null));
    const { unmount } = show({ onToggleBill });
    fireEvent.click(toggle());
    expect(onToggleBill).toHaveBeenCalledWith(true);
    unmount();
    show({ session: BILL, onToggleBill });
    fireEvent.click(toggle());
    expect(onToggleBill).toHaveBeenLastCalledWith(false);
  });

  it("says the failure under the row and stays usable", async () => {
    show({ onToggleBill: vi.fn(() => Promise.resolve("Il tavolo è già chiuso.")) });
    await act(async () => fireEvent.click(toggle()));
    expect(screen.getByRole("alert").textContent).toBe("Il tavolo è già chiuso.");
    expect(toggle().disabled).toBe(false);
  });

  it("is off while its own write is in flight, so a double tap sends once", async () => {
    let finish: (value: string | null) => void = () => undefined;
    const onToggleBill = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
    show({ onToggleBill });
    fireEvent.click(toggle());
    expect(toggle().disabled).toBe(true);
    fireEvent.click(toggle());
    expect(onToggleBill).toHaveBeenCalledTimes(1);
    await act(async () => finish(null));
    expect(toggle().disabled).toBe(false);
  });
});

describe("TableHeader 'Tavolo ▾' disclosure", () => {
  it("is named 'Tavolo: altre azioni', shows 'Tavolo', and opens and closes in place", () => {
    show();
    expect(more().textContent).toContain("Tavolo");
    expect(more().className).toContain("min-h-tap");
    expect(more().getAttribute("aria-expanded")).toBe("false");
    expect(card()).toBeNull();
    fireEvent.click(more());
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(card()).toBeTruthy();
    fireEvent.click(more());
    expect(more().getAttribute("aria-expanded")).toBe("false");
    expect(card()).toBeNull();
  });

  it("controls the card it opens", () => {
    show();
    fireEvent.click(more());
    expect(more().getAttribute("aria-controls")).toBe(card()!.id);
  });

  it("holds 'Modifica coperti': the stepper starts at the table's covers and saving sends the number", async () => {
    const onChangeCovers = vi.fn(() => Promise.resolve(null));
    show({ onChangeCovers });
    fireEvent.click(more());
    const field = within(card()!).getByLabelText("Coperti") as HTMLInputElement;
    expect(field.value).toBe("4");
    fireEvent.change(field, { target: { value: "6" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salva coperti" })));
    expect(onChangeCovers).toHaveBeenCalledWith(6);
    // Saved: the card folds away.
    expect(card()).toBeNull();
    expect(more().getAttribute("aria-expanded")).toBe("false");
  });

  it("puts focus back on 'Tavolo ▾' when the card folds after a save and after 'Annulla'", async () => {
    show();
    fireEvent.click(more());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salva coperti" })));
    expect(document.activeElement).toBe(more());
    fireEvent.click(more());
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it("steps with the + button", async () => {
    const onChangeCovers = vi.fn(() => Promise.resolve(null));
    show({ onChangeCovers });
    fireEvent.click(more());
    fireEvent.click(screen.getByRole("button", { name: "Più un coperto" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salva coperti" })));
    expect(onChangeCovers).toHaveBeenCalledWith(5);
  });

  it("refuses covers outside 1 to 99 inside the card, without calling out", () => {
    const onChangeCovers = vi.fn(() => Promise.resolve(null));
    show({ onChangeCovers });
    fireEvent.click(more());
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva coperti" }));
    expect(onChangeCovers).not.toHaveBeenCalled();
    expect(within(card()!).getByRole("alert").textContent).toBe("I coperti vanno da 1 a 99.");
  });

  it("keeps the card open and says the server's refusal inside it", async () => {
    show({ onChangeCovers: vi.fn(() => Promise.resolve("Il tavolo è già chiuso.")) });
    fireEvent.click(more());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salva coperti" })));
    expect(within(card()!).getByRole("alert").textContent).toBe("Il tavolo è già chiuso.");
    expect(more().getAttribute("aria-expanded")).toBe("true");
  });

  it("'Annulla' folds the card without saving, and it reopens at the table's covers", () => {
    const onChangeCovers = vi.fn(() => Promise.resolve(null));
    show({ onChangeCovers });
    fireEvent.click(more());
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(card()).toBeNull();
    expect(onChangeCovers).not.toHaveBeenCalled();
    fireEvent.click(more());
    expect((screen.getByLabelText("Coperti") as HTMLInputElement).value).toBe("4");
  });
});

describe("TableHeader offline (M20, Q123 default; P2c-4)", () => {
  it("'Conto richiesto' is off, 'Tavolo ▾' stays openable, with one 'Serve la connessione'", () => {
    show({ offline: true });
    expect(toggle().disabled).toBe(true);
    expect(more().disabled).toBe(false);
    expect(screen.getAllByText("Serve la connessione")).toHaveLength(1);
  });

  it("offline, the card opens with the covers field and 'Salva' off, 'Annulla' on, and the one sentence inside", () => {
    const onChangeCovers = vi.fn(() => Promise.resolve(null));
    show({ offline: true, onChangeCovers });
    fireEvent.click(more());
    expect(more().getAttribute("aria-expanded")).toBe("true");
    const group = card()!;
    expect((within(group).getByLabelText("Coperti") as HTMLInputElement).disabled).toBe(true);
    const save = within(group).getByRole("button", { name: "Salva coperti" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onChangeCovers).not.toHaveBeenCalled();
    expect(
      (within(group).getByRole("button", { name: "Annulla" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(within(group).getAllByText("Serve la connessione")).toHaveLength(1);
    expect(screen.getAllByText("Serve la connessione")).toHaveLength(1);
    expect(toggle().disabled).toBe(true);
    fireEvent.click(within(group).getByRole("button", { name: "Annulla" }));
    expect(card()).toBeNull();
  });

  it("online, the card's controls are on and it holds no sentence", () => {
    show();
    fireEvent.click(more());
    const group = card()!;
    expect((within(group).getByLabelText("Coperti") as HTMLInputElement).disabled).toBe(false);
    expect(
      (within(group).getByRole("button", { name: "Salva coperti" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("Serve la connessione")).toBeNull();
  });

  it("online they work and the hint is not there", () => {
    show();
    expect(toggle().disabled).toBe(false);
    expect(more().disabled).toBe(false);
    expect(screen.queryByText("Serve la connessione")).toBeNull();
  });
});

describe("TableHeader on a closed session", () => {
  it.each([false, true])("renders neither control, offline %s", (offline) => {
    show({ session: { ...OPEN, status: "closed", closed: true }, offline });
    expect(screen.getByRole("heading", { level: 1, name: "Tavolo 1 (demo)" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Serve la connessione")).toBeNull();
  });
});
