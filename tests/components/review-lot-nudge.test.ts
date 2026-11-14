// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeLine, makeReview } from "../helpers/review-line";
import type { ApprovalInfo, InvoiceReview } from "@/server/invoices/review-types";

// P2-2 spec §6: stock lines with no lot code carry "Lotto mancante"; before "Approva" one sentence counts them and "Mostra la prima" opens the
// first one with the cursor in the Lotto field. Approval is never blocked.
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });

let review: InvoiceReview;
const apiJson = vi.fn((path: string): Promise<Result> => {
  if (path.endsWith("/review")) return Promise.resolve(ok({ review }));
  if (path.startsWith("/api/ingredients")) return Promise.resolve(ok({ ingredients: [] }));
  if (path.startsWith("/api/cost-centres")) return Promise.resolve(ok({ costCentres: [] }));
  if (path.startsWith("/api/suppliers")) return Promise.resolve(ok({ suppliers: [] }));
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("@/components/use-media-query", () => ({ useMediaQuery: () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { ApprovalPanel } from "@/app/(owner)/fatture/[id]/revisione/approval-panel";
import { LineEditor } from "@/app/(owner)/fatture/[id]/revisione/line-editor";
import { LineRow } from "@/app/(owner)/fatture/[id]/revisione/review-line";
import ReviewPage from "@/app/(owner)/fatture/[id]/revisione/page";
import { firstLotMissingLineId } from "@/lib/invoices/review-view";

const L1 = "11000000-0000-4000-8000-0000000000a1";
const L2 = "11000000-0000-4000-8000-0000000000a2";
const L3 = "11000000-0000-4000-8000-0000000000a3";
const approval: ApprovalInfo = {
  canApprove: true,
  blockers: [],
  receiptDate: "1998-11-13",
  payable: {
    grossAmount: 100,
    creditedAmount: 0,
    amount: 100,
    dueDate: "1998-12-13",
    dueDateSource: "supplier_terms",
  },
  receipts: 3,
  locations: { required: false, options: [{ id: "l1", name: "Cella" }], defaultId: "l1" },
};
const lines = [
  makeLine({ id: L1, rawDescription: "Farina Demo", lotCode: "L-1", lotMissing: false }),
  makeLine({ id: L2, position: 2, rawDescription: "Mozzarella Demo", lotMissing: true }),
  makeLine({ id: L3, position: 3, rawDescription: "Pomodoro Demo", lotMissing: true }),
];
const actions = { approve: async () => null, reject: async () => null };

const scrollIntoView = vi.fn();
beforeEach(() => {
  review = makeReview(lines, { approval });
  apiJson.mockClear();
  scrollIntoView.mockClear();
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(cleanup);

describe("the 'Lotto mancante' badge", () => {
  it("is on a line with lotMissing, in words, in the warning tone", () => {
    render(createElement(LineRow, { line: lines[1]! }));
    const badge = screen.getByText("Lotto mancante");
    expect(badge.className).toContain("bg-warning-bg");
    expect(badge.getAttribute("data-badge")).toBe("lot-missing");
  });

  it("is absent on a line with a lot, and on a line that is not marked", () => {
    render(createElement(LineRow, { line: lines[0]! }));
    expect(screen.queryByText("Lotto mancante")).toBeNull();
  });
});

describe("the hint under the Lotto field", () => {
  it("tells the owner to copy the lot from the packaging, if there is one", () => {
    render(
      createElement(LineEditor, {
        line: lines[1]!,
        ingredients: [],
        costCentres: [],
        actions: {
          saveLine: async () => null,
          createCentre: async () => ({ id: "c" }),
          split: async () => null,
          unsplit: async () => null,
        },
        onClose: () => undefined,
      }),
    );
    const field = screen.getByLabelText(/^Lotto/);
    expect(field.closest("label")!.textContent).toContain(
      "Copia il lotto dall'etichetta della confezione, se c'è.",
    );
  });

  it("puts the cursor in the Lotto field when asked to", () => {
    const editor = (token: number) =>
      createElement(LineEditor, {
        line: lines[1]!,
        ingredients: [],
        costCentres: [],
        focusLotToken: token,
        actions: {
          saveLine: async () => null,
          createCentre: async () => ({ id: "c" }),
          split: async () => null,
          unsplit: async () => null,
        },
        onClose: () => undefined,
      });
    const view = render(editor(0));
    expect(document.activeElement).not.toBe(screen.getByLabelText(/^Lotto/));
    view.rerender(editor(1));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Lotto/));
  });
});

describe("the approval panel's lot sentence", () => {
  it("counts the lines without a lot, offers 'Mostra la prima', and leaves 'Approva fattura' enabled", () => {
    const onShow = vi.fn();
    render(createElement(ApprovalPanel, { review, actions, onShowFirstMissingLot: onShow }));
    const note = screen.getByRole("status");
    expect(note.textContent).toContain(
      "2 righe di magazzino senza lotto. Puoi aggiungerlo ora; dopo l'approvazione non si potrà più.",
    );
    fireEvent.click(within(note).getByRole("button", { name: "Mostra la prima" }));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", { name: "Approva fattura" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("says '1 riga' for one, and shows nothing at all for none", () => {
    review = makeReview([lines[0]!, lines[1]!], { approval });
    const view = render(createElement(ApprovalPanel, { review, actions }));
    expect(screen.getByRole("status").textContent).toContain("1 riga di magazzino senza lotto.");
    view.unmount();
    render(
      createElement(ApprovalPanel, { review: makeReview([lines[0]!], { approval }), actions }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/senza lotto/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Approva fattura" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("is not shown on a decided invoice", () => {
    render(
      createElement(ApprovalPanel, {
        review: makeReview(lines, {
          editable: false,
          approval: null,
          decision: {
            action: "approved",
            at: "1998-11-13T08:12:00+00:00",
            byName: "Titolare Demo",
            reason: null,
          },
        }),
        actions,
      }),
    );
    expect(screen.queryByText(/senza lotto/)).toBeNull();
  });
});

describe("firstLotMissingLineId", () => {
  it("is the first marked line in screen order, a part of a split line included, or null", () => {
    expect(firstLotMissingLineId(lines)).toBe(L2);
    expect(firstLotMissingLineId([lines[0]!])).toBeNull();
    const parent = makeLine({
      id: L1,
      isSplit: true,
      children: [makeLine({ id: L3, parentLineId: L1, lotMissing: true })],
    });
    expect(firstLotMissingLineId([parent, lines[1]!])).toBe(L3);
  });
});

describe("the review page: 'Mostra la prima'", () => {
  it("opens the first marked line's editor with the cursor in its Lotto field, and approval stays possible", async () => {
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(ReviewPage, { params: Promise.resolve({ id: review.invoice.id }) }),
        ),
      );
    });
    await screen.findByText("Mozzarella Demo");
    expect(screen.getAllByText("Lotto mancante")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mostra la prima" }));
    });
    const row = document.getElementById(`line-${L2}`)!;
    expect(scrollIntoView.mock.contexts[0]).toBe(row);
    const lot = within(row).getByLabelText(/^Lotto/);
    expect(document.activeElement).toBe(lot);
    // The other marked line stays closed.
    expect(within(document.getElementById(`line-${L3}`)!).queryByLabelText(/^Lotto/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Approva fattura" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
