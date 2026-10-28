// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderSheet } from "@/app/(owner)/tavoli/[sessionId]/order-sheet";
import { LINE_SOUP, LINE_STEW, OIDS } from "../helpers/orders-data";

afterEach(cleanup);
type Props = Parameters<typeof OrderSheet>[0];
const show = (over: Partial<Props> = {}) =>
  render(
    createElement(OrderSheet, {
      lines: [LINE_SOUP, LINE_STEW],
      expanded: true,
      onToggle: () => undefined,
      pendingIds: new Set<string>(),
      failedIds: new Set<string>(),
      onRetry: () => undefined,
      onDiscard: () => undefined,
      editingId: null,
      onEdit: () => undefined,
      renderEditor: () => createElement("div", { "data-testid": "editor" }),
      ...over,
    }),
  );

describe("OrderSheet", () => {
  it("the bar says how many rows and toggles the list", () => {
    const onToggle = vi.fn();
    show({ onToggle });
    const bar = screen.getByRole("button", { name: "Comanda · 2 righe" });
    expect(bar.getAttribute("aria-expanded")).toBe("true");
    expect(bar.className).toContain("min-h-tap");
    fireEvent.click(bar);
    expect(onToggle).toHaveBeenCalled();
  });

  it("an empty order is just 'Comanda'", () => {
    show({ lines: [], expanded: false });
    expect(screen.getByRole("button", { name: "Comanda" })).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("an empty expanded order says what to do", () => {
    show({ lines: [], expanded: true });
    expect(screen.getByText("Nessuna riga ancora. Tocca un piatto per aggiungerlo.")).toBeTruthy();
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

  it("is collapsed to the bar when not expanded", () => {
    const { container } = show({ expanded: false });
    expect(container.querySelector("[data-line-id]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Comanda · 2 righe" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("renders the editor under the line being edited only", () => {
    show({ editingId: OIDS.line1 });
    const row = document.querySelector(`[data-line-id="${OIDS.line1}"]`) as HTMLElement;
    expect(within(row).getByTestId("editor")).toBeTruthy();
    expect(screen.getAllByTestId("editor")).toHaveLength(1);
  });

  it("a failed line offers a retry through the sheet", () => {
    const onRetry = vi.fn();
    show({ pendingIds: new Set([OIDS.line1]), failedIds: new Set([OIDS.line1]), onRetry });
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(onRetry).toHaveBeenCalledWith(OIDS.line1);
  });

  it("marks pending lines", () => {
    show({ pendingIds: new Set([OIDS.line1]) });
    expect(screen.getAllByText("Invio…")).toHaveLength(1);
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

    it("waits for a line that is still being sent: its course cannot be sent", () => {
      show({
        lines: [DRAFT_A, DRAFT_B],
        onSend: () => undefined,
        pendingIds: new Set([DRAFT_B.id]),
      });
      expect(screen.getByText("Attendi l'invio delle righe")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Invia in cucina: Secondi, 1 piatto" }),
      ).toBeTruthy();
    });

    it("while one course is being sent, the others wait without saying 'Invio…'", () => {
      show({
        lines: [DRAFT_A, DRAFT_B],
        onSend: () => undefined,
        sending: { course: "primi", segue: false },
      });
      expect(screen.getAllByText("Invio\u2026")).toHaveLength(1);
      const secondi = screen
        .getByRole("heading", { level: 3, name: "Secondi" })
        .closest("section")!;
      expect(
        (within(secondi).getByRole("button", { name: /^Invia in cucina/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
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
      const row = document.querySelector(`[data-line-id="${LINE_SOUP.id}"]`) as HTMLElement;
      expect(within(row).getByText("Stornato")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Comanda · 1 riga" })).toBeTruthy();
    });

    it("renders the void dialog under the sent line being voided only", () => {
      show({
        lines: [{ ...LINE_STEW, state: "fired" }],
        onVoid: () => undefined,
        voidingId: LINE_STEW.id,
        renderVoid: () => createElement("div", { "data-testid": "void" }),
      });
      const row = document.querySelector(`[data-line-id="${LINE_STEW.id}"]`) as HTMLElement;
      expect(within(row).getByTestId("void")).toBeTruthy();
    });
  });
});
