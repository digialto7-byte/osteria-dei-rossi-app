// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderSheet } from "@/app/(owner)/tavoli/comanda/order-sheet";
import { LINE_SOUP, LINE_STEW, OIDS } from "../helpers/orders-data";

afterEach(cleanup);
type Props = Parameters<typeof OrderSheet>[0];
const show = (over: Partial<Props> = {}) =>
  render(
    createElement(OrderSheet, {
      lines: [LINE_SOUP, LINE_STEW],
      course: "primi" as const,
      sending: false,
      onDiscard: () => undefined,
      editingId: null,
      onEdit: () => undefined,
      renderEditor: () => createElement("div", { "data-testid": "editor" }),
      ...over,
    }),
  );

describe("OrderSheet", () => {
  // P2b-5 (Direct comanda, D13): the lines are open on arrival, under the h2 "Comanda"; the bar's summary takes the waiter back to them.
  it("shows the lines open, with no tap, under the h2 'Comanda'", () => {
    const { container } = show();
    const title = screen.getByRole("heading", { level: 2, name: "Comanda" });
    expect(title.getAttribute("tabindex")).toBe("-1");
    const rows = [...container.querySelectorAll("[data-line-id]")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(title.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("the bar says how many rows; it has no aria-expanded; a tap scrolls to the h2 and focuses it", () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      show();
      const bar = screen.getByRole("button", { name: "Comanda · 2 righe · 1 da inviare" });
      expect(bar.hasAttribute("aria-expanded")).toBe(false);
      expect(bar.classList.contains("min-h-tap-comfort")).toBe(true);
      const title = screen.getByRole("heading", { level: 2, name: "Comanda" });
      fireEvent.click(bar);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(title);
      expect(document.activeElement).toBe(title);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("an empty order is just 'Comanda' on the bar, and the card says what to do", () => {
    show({ lines: [] });
    expect(screen.getByRole("button", { name: "Comanda" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Comanda" })).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Nessun piatto ancora: scegli dal menu qui sotto.")).toBeTruthy();
  });

  it("has no hint once there are lines", () => {
    show();
    expect(screen.queryByText("Nessun piatto ancora: scegli dal menu qui sotto.")).toBeNull();
  });

  it("puts what the page gives it (the course tabs and the menu) between the lines and the bar", () => {
    show({ children: createElement("div", { "data-testid": "menu" }) });
    const title = screen.getByRole("heading", { level: 2, name: "Comanda" });
    const menu = screen.getByTestId("menu");
    const bar = screen.getByRole("button", { name: /^Comanda · / });
    expect(title.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(menu.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("groups the lines by course in service order", () => {
    const { container } = show();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Primi", "Secondi"]);
    const ids = [...container.querySelectorAll("[data-line-id]")].map((e) =>
      e.getAttribute("data-line-id"),
    );
    expect(ids).toEqual([OIDS.line2, OIDS.line1]);
  });

  it("renders the editor under the line being edited only", () => {
    show({ editingId: OIDS.line1 });
    const row = document.querySelector(`[data-line-id="${OIDS.line1}"]`) as HTMLElement;
    expect(within(row).getByTestId("editor")).toBeTruthy();
    expect(screen.getAllByTestId("editor")).toHaveLength(1);
  });

  describe("sending and voiding (M19)", () => {
    const DRAFT_A = {
      ...LINE_STEW,
      id: "20000000-0000-4000-8000-00000000000a",
      state: "draft" as const,
    };
    const DRAFT_B = {
      ...LINE_SOUP,
      id: "20000000-0000-4000-8000-00000000000b",
      state: "draft" as const,
      segue: false,
    };
    const DRAFT_C = {
      ...LINE_SOUP,
      id: "20000000-0000-4000-8000-00000000000c",
      state: "draft" as const,
      segue: true,
    };

    it("ends each course with the send buttons of its drafts, and sends their ids", () => {
      const onSend = vi.fn();
      show({ lines: [DRAFT_A, DRAFT_B, DRAFT_C], onSend });
      const primi = screen.getByRole("heading", { level: 3, name: "Primi" }).closest("section")!;
      fireEvent.click(
        within(primi).getByRole("button", { name: "Invia in cucina: Primi, 1 piatto" }),
      );
      expect(onSend).toHaveBeenLastCalledWith([DRAFT_B.id]);
      fireEvent.click(within(primi).getByRole("button", { name: /Primi a seguire/ }));
      expect(onSend).toHaveBeenLastCalledWith([DRAFT_C.id]);
      const secondi = screen
        .getByRole("heading", { level: 3, name: "Secondi" })
        .closest("section")!;
      fireEvent.click(
        within(secondi).getByRole("button", { name: "Invia in cucina: Secondi, 1 piatto" }),
      );
      expect(onSend).toHaveBeenLastCalledWith([DRAFT_A.id]);
    });

    it("no send buttons without drafts, and none when the page gives no onSend", () => {
      show({ lines: [{ ...LINE_STEW, state: "fired" }], onSend: () => undefined });
      expect(screen.queryByRole("button", { name: /^Invia/ })).toBeNull();
      cleanup();
      show({ lines: [DRAFT_A] });
      expect(screen.queryByRole("button", { name: /^Invia/ })).toBeNull();
    });

    it("lists a line voided after sending, struck through, and keeps it out of the row count", () => {
      show({ lines: [DRAFT_A, { ...LINE_SOUP, state: "voided" }] });
      fireEvent.click(screen.getByRole("button", { name: "Primi · 1 inviato" }));
      const row = document.querySelector(`[data-line-id="${LINE_SOUP.id}"]`) as HTMLElement;
      expect(within(row).getByText("Stornato")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Comanda · 1 riga · 1 da inviare" })).toBeTruthy();
    });

    it("renders the void dialog under the sent line being voided only", () => {
      show({
        lines: [{ ...LINE_STEW, state: "fired" }],
        onVoid: () => undefined,
        voidingId: LINE_STEW.id,
        renderVoid: () => createElement("div", { "data-testid": "void" }),
      });
      fireEvent.click(screen.getByRole("button", { name: "Secondi · 1 inviato" }));
      const row = document.querySelector(`[data-line-id="${LINE_STEW.id}"]`) as HTMLElement;
      expect(within(row).getByTestId("void")).toBeTruthy();
    });
  });
});

describe("OrderSheet: the sticky bar (W1)", () => {
  const draft = (id: string, course: "antipasti" | "primi" | "secondi", extra = {}) => ({
    ...LINE_STEW,
    id,
    course,
    state: "draft" as const,
    segue: false,
    ...extra,
  });
  const A1 = draft("20000000-0000-4000-8000-0000000000a1", "antipasti");
  const A2 = draft("20000000-0000-4000-8000-0000000000a2", "antipasti");
  const P1 = draft("20000000-0000-4000-8000-0000000000b1", "primi");
  const bar = () => document.querySelector('[data-slot="sticky-action-bar"]') as HTMLElement;
  const primary = () => within(bar()).queryByRole("button", { name: /^Invia/ });

  it("(1) names the course and the count, and sends exactly that course's ids", () => {
    const onSend = vi.fn();
    show({ lines: [A1, A2], course: "primi", onSend });
    fireEvent.click(within(bar()).getByRole("button", { name: "Invia antipasti · 2" }));
    expect(onSend).toHaveBeenCalledWith([A1.id, A2.id]);
  });

  it("both bar buttons are comfort-sized", () => {
    show({ lines: [A1], course: "antipasti", onSend: () => undefined });
    for (const button of within(bar()).getAllByRole("button")) {
      expect(button.classList.contains("min-h-tap-comfort")).toBe(true);
      expect(button.classList.contains("min-h-tap")).toBe(false);
    }
  });

  it("(2) the selected course with drafts wins", () => {
    show({ lines: [A1, P1], course: "primi", onSend: () => undefined });
    expect(primary()?.textContent).toBe("Invia primi · 1");
  });

  it("(3) with no drafts the bar's only button is the summary, and it is not green", () => {
    show({ lines: [{ ...A1, state: "fired" as const }], onSend: () => undefined });
    const buttons = within(bar()).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.hasAttribute("aria-expanded")).toBe(false);
    expect(buttons[0]!.classList.contains("bg-accent")).toBe(false);
  });

  it("(4) while sending the primary reads 'Invio…' and is disabled, and so is every sheet send button", () => {
    show({ lines: [A1, P1], course: "antipasti", sending: true, onSend: () => undefined });
    const busy = within(bar()).getByRole("button", { name: "Invio…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    const sheetSend = screen.getAllByRole("button", { name: /^Invia in cucina/ });
    expect(sheetSend.length).toBeGreaterThan(0);
    for (const button of sheetSend) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("(5) at most one green element in the bar, and never the summary", () => {
    for (const lines of [[A1, P1], [A1], []]) {
      cleanup();
      show({ lines, course: "primi", onSend: () => undefined });
      expect(bar().querySelectorAll(".bg-accent").length).toBeLessThanOrEqual(1);
      const summary = within(bar()).getByRole("button", { name: /^Comanda/ });
      expect(summary.classList.contains("bg-accent")).toBe(false);
    }
  });

  it("(6) the bar's send is the one primary of the whole sheet: the course buttons in the list are secondary", () => {
    const { container } = show({
      lines: [A1, A2, P1],
      course: "antipasti",
      onSend: () => undefined,
    });
    expect(container.querySelectorAll(".bg-accent")).toHaveLength(1);
    expect(bar().querySelectorAll(".bg-accent")).toHaveLength(1);
  });

  it("has no primary when the page gives no onSend", () => {
    show({ lines: [A1], onSend: undefined });
    expect(primary()).toBeNull();
  });

  it("the bar is a direct sibling of the card, not inside a wrapper that ends with it", () => {
    const { container } = show({ lines: [A1], onSend: () => undefined });
    expect(bar().parentElement).toBe(container);
  });
});

describe("OrderSheet: queued lines (M20)", () => {
  const DRAFT = {
    ...LINE_STEW,
    id: "20000000-0000-4000-8000-00000000000a",
    state: "draft" as const,
  };

  it("a draft whose fire is already queued gets no second send button, while the others still do", () => {
    const queuedFire = { ...DRAFT, queue: "fire" as const };
    const other = {
      ...LINE_SOUP,
      id: "20000000-0000-4000-8000-00000000000b",
      state: "draft" as const,
      segue: false,
    };
    const onSend = vi.fn();
    show({ lines: [queuedFire, other], onSend });
    expect(screen.queryByRole("button", { name: "Invia in cucina: Secondi, 1 piatto" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Invia in cucina: Primi, 1 piatto" }));
    expect(onSend).toHaveBeenCalledWith([other.id]);
  });

  it("'Scarta' on a queued add goes through the sheet, and there is no 'Riprova' anywhere", () => {
    const onDiscard = vi.fn();
    show({ lines: [{ ...DRAFT, queue: "add" as const, queuedAddOpId: "0e0" }], onDiscard });
    fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
    expect(onDiscard).toHaveBeenCalledWith(DRAFT.id);
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
    expect(screen.queryByText("Invio…")).toBeNull();
  });

  it("a queued fire reads 'In coda per la cucina' on the sheet, never 'In cucina'", () => {
    show({ lines: [{ ...DRAFT, queue: "fire" as const }] });
    expect(screen.getByText("In coda per la cucina")).toBeTruthy();
    expect(screen.queryByText("In cucina")).toBeNull();
  });
});

// P2b-6 (Direct comanda, D14): the sent lines of a course fold to one row, "Primi · 3 inviati", that unfolds in place.
describe("OrderSheet: sent lines fold per course", () => {
  const sent = (id: string, course: "primi" | "secondi", state: "fired" | "voided" = "fired") => ({
    ...LINE_STEW,
    id,
    course,
    state,
  });
  const F1 = sent("30000000-0000-4000-8000-000000000001", "primi");
  const F2 = sent("30000000-0000-4000-8000-000000000002", "primi");
  const V1 = sent("30000000-0000-4000-8000-000000000003", "primi", "voided");
  const row = (id: string) =>
    document.querySelector(`[data-line-id="${id}"]`) as HTMLElement | null;

  it("hides a fired line behind 'Primi · 1 inviato' until it is tapped, and shows 'Storna' then", () => {
    show({ lines: [F1], onVoid: () => undefined });
    expect(row(F1.id)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Storna/ })).toBeNull();
    const fold = screen.getByRole("button", { name: "Primi · 1 inviato" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(fold.className).toContain("min-h-tap");
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(row(F1.id)).not.toBeNull();
    expect(within(row(F1.id)!).getByRole("button", { name: /^Storna/ })).toBeTruthy();
    fireEvent.click(fold);
    expect(row(F1.id)).toBeNull();
    expect(fold.getAttribute("aria-expanded")).toBe("false");
  });

  it("counts every sent line of the course, voided ones included, and keeps the arrow out of the name", () => {
    show({ lines: [F1, F2, V1] });
    const fold = screen.getByRole("button", { name: "Primi · 3 inviati" });
    expect(fold.querySelector('[aria-hidden="true"]')?.textContent).toBe("▸");
  });

  it("the arrow turns from ▸ to ▾ while the course is open, and aria-controls names the list only while it is in the page", () => {
    show({ lines: [F1, F2] });
    const fold = screen.getByRole("button", { name: "Primi · 2 inviati" });
    const glyph = () => fold.querySelector('[aria-hidden="true"]')?.textContent;
    // Folded: the list is not rendered, so nothing is named (as table-header's "Tavolo ▾" does).
    expect(fold.hasAttribute("aria-controls")).toBe(false);
    expect(glyph()).toBe("▸");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fold);
    expect(glyph()).toBe("▾");
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const controls = fold.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const list = document.getElementById(controls!)!;
    expect(list.tagName).toBe("UL");
    expect(list.contains(row(F1.id))).toBe(true);
    expect(list.contains(row(F2.id))).toBe(true);
    fireEvent.click(fold);
    expect(glyph()).toBe("▸");
    expect(fold.hasAttribute("aria-controls")).toBe(false);
  });

  it("gives each course's fold row its own aria-controls", () => {
    const S = sent("30000000-0000-4000-8000-0000000000e2", "secondi");
    show({ lines: [F1, S] });
    const a = screen.getByRole("button", { name: "Primi · 1 inviato" });
    const b = screen.getByRole("button", { name: "Secondi · 1 inviato" });
    fireEvent.click(a);
    fireEvent.click(b);
    expect(a.getAttribute("aria-controls")).toBeTruthy();
    expect(a.getAttribute("aria-controls")).not.toBe(b.getAttribute("aria-controls"));
  });

  it("shows a voided line struck through inside the unfolded course", () => {
    show({ lines: [F1, V1] });
    fireEvent.click(screen.getByRole("button", { name: "Primi · 2 inviati" }));
    expect(within(row(V1.id)!).getByText("Stornato")).toBeTruthy();
    expect(row(V1.id)!.querySelector(".line-through")).not.toBeNull();
  });

  it("keeps drafts in full beside the fold row of the same course", () => {
    const draft = { ...F1, id: "30000000-0000-4000-8000-0000000000d1", state: "draft" as const };
    show({ lines: [draft, F2], onSend: () => undefined });
    expect(row(draft.id)).not.toBeNull();
    expect(row(F2.id)).toBeNull();
    const section = screen.getByRole("heading", { level: 3, name: "Primi" }).closest("section")!;
    expect(within(section).getByRole("button", { name: "Primi · 1 inviato" })).toBeTruthy();
    // The fold row comes after the course's send buttons.
    const send = within(section).getByRole("button", { name: /^Invia in cucina/ });
    const fold = within(section).getByRole("button", { name: "Primi · 1 inviato" });
    expect(send.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("folds each course on its own, and has no fold row for a course with no sent line", () => {
    const S = sent("30000000-0000-4000-8000-0000000000e1", "secondi");
    const draft = { ...F1, id: "30000000-0000-4000-8000-0000000000d2", state: "draft" as const };
    show({ lines: [draft, F1, S] });
    fireEvent.click(screen.getByRole("button", { name: "Secondi · 1 inviato" }));
    expect(row(S.id)).not.toBeNull();
    expect(row(F1.id)).toBeNull();
    expect(screen.getAllByRole("button", { name: /inviat[oi]$/ })).toHaveLength(2);
  });

  it("keeps a course unfolded across a re-render with new lines (the waiter's choice stands)", () => {
    const { rerender } = show({ lines: [F1] });
    fireEvent.click(screen.getByRole("button", { name: "Primi · 1 inviato" }));
    rerender(
      createElement(OrderSheet, {
        lines: [F1, F2],
        course: "primi" as const,
        sending: false,
        onDiscard: () => undefined,
        editingId: null,
        onEdit: () => undefined,
        renderEditor: () => null,
      }),
    );
    expect(row(F2.id)).not.toBeNull();
  });
});
