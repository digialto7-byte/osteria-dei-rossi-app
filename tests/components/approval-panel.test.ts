import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalPanel, ApproveConfirm } from "@/app/(owner)/fatture/[id]/revisione/approval-panel";
import type { ApprovalInfo, InvoiceReview } from "@/server/invoices/review-types";
import { makeLine, makeReview } from "../helpers/review-line";

const actions = { approve: async () => null, reject: async () => null };
const NBSP = " ";

const approval = (over: Partial<ApprovalInfo> = {}): ApprovalInfo => ({
  canApprove: true,
  blockers: [],
  receiptDate: "2026-09-29",
  payable: {
    grossAmount: 1240,
    creditedAmount: 5.5,
    amount: 1234.5,
    dueDate: "2026-10-29",
    dueDateSource: "supplier_terms",
  },
  receipts: 6,
  locations: { required: false, options: [{ id: "l1", name: "Cella" }], defaultId: "l1" },
  ...over,
});

const render = (review: InvoiceReview) =>
  renderToStaticMarkup(createElement(ApprovalPanel, { review, actions }));

const inReview = (over: Partial<ApprovalInfo> = {}) =>
  makeReview([makeLine()], { approval: approval(over) });

const decided = (over: Partial<InvoiceReview> = {}) =>
  makeReview([makeLine()], {
    editable: false,
    invoice: { ...makeReview().invoice, status: "approved" },
    decision: {
      action: "approved",
      at: "2026-10-22T08:12:00+00:00",
      byName: "Titolare Demo",
      reason: null,
    },
    posting: {
      payable: {
        grossAmount: 1240,
        creditedAmount: 5.5,
        amount: 1234.5,
        dueDate: "2026-10-29",
        dueDateSource: "supplier_terms",
        status: "open",
      },
      locationName: "Cella",
    },
    ...over,
  });

const primaryButtons = (html: string) => html.match(/<button[^>]*bg-accent[^>]*>/g) ?? [];

describe("ApprovalPanel while the invoice is in review", () => {
  it("shows the payable with its due date, the receipt date and the number of receipts", () => {
    const html = render(inReview());
    expect(html).toContain(`Da pagare 1.234,50${NBSP}€ entro il 29/10/2026`);
    expect(html).toContain("dai termini del fornitore");
    expect(html).toContain(`Totale fattura 1.240,00${NBSP}€ meno resi 5,50${NBSP}€`);
    expect(html).toContain("Carico del 29/09/2026 · 6 carichi in Cella");
  });

  it("amounts sit in .num", () => {
    const html = render(inReview());
    expect(html).toMatch(/<p[^>]*data-testid="approval-payable"[^>]*class="num[^"]*"/);
  });

  it("with no blocker 'Approva fattura' is enabled and is the one primary button", () => {
    const html = render(inReview());
    const approve = html.match(/<button[^>]*>Approva fattura<\/button>/)![0];
    expect(approve).not.toContain('disabled=""');
    expect(approve).not.toContain("aria-describedby");
    expect(primaryButtons(html)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*border-ink[^>]*>Rifiuta<\/button>/);
    expect(html).not.toContain("approval-blockers");
  });

  it("with blockers the primary button is disabled and points at the list; they read as words", () => {
    const html = render(
      inReview({
        canApprove: false,
        blockers: [
          { code: "total_mismatch", lineIds: [] },
          { code: "lines_unmapped", lineIds: ["11000000-0000-4000-8000-000000000001", "b"] },
        ],
      }),
    );
    const approve = html.match(/<button[^>]*>Approva fattura<\/button>/)![0];
    expect(approve).toContain('disabled=""');
    const listId = html.match(/<ul id="([^"]+)"[^>]*data-testid="approval-blockers"/)![1];
    expect(approve).toContain(`aria-describedby="${listId}"`);
    expect(html).toContain("Il totale non corrisponde: correggi le righe o l&#x27;intestazione.");
    expect(html).toContain("2 righe da abbinare.");
    expect(primaryButtons(html)).toHaveLength(1);
  });

  it("a blocker about lines links to the first of them", () => {
    const html = render(
      inReview({
        canApprove: false,
        blockers: [{ code: "lines_unmapped", lineIds: ["aa", "bb"] }],
      }),
    );
    expect(html).toMatch(/<a href="#line-aa"[^>]*>Vedi la prima riga<\/a>/);
    const single = render(
      inReview({ canApprove: false, blockers: [{ code: "lines_unmapped", lineIds: ["cc"] }] }),
    );
    expect(single).toMatch(/<a href="#line-cc"[^>]*>Vedi riga<\/a>/);
  });

  it("shows the location select only when the server says a choice is needed", () => {
    expect(render(inReview())).not.toContain("<select");
    const html = render(
      inReview({
        canApprove: false,
        blockers: [{ code: "location_required", lineIds: [] }],
        locations: {
          required: true,
          options: [
            { id: "l1", name: "Cella" },
            { id: "l2", name: "Dispensa" },
          ],
          defaultId: null,
        },
      }),
    );
    expect(html).toContain("<select");
    expect(html).toContain("Ubicazione");
    expect(html).toContain(">Dispensa<");
    // Nothing chosen yet: the sentence stays and approval is closed.
    expect(html).toContain("Scegli l&#x27;ubicazione del carico.");
    expect(html.match(/<button[^>]*>Approva fattura<\/button>/)![0]).toContain('disabled=""');
  });

  it("every control sits inside a label", () => {
    const html = render(
      inReview({
        locations: {
          required: true,
          options: [{ id: "l1", name: "Cella" }],
          defaultId: "l1",
        },
      }),
    );
    expect(html.replace(/<label[\s\S]*?<\/label>/g, "")).not.toMatch(/<(input|select)\b/);
  });

  it("leaves out the payable until the server can work it out", () => {
    const html = render(
      inReview({
        canApprove: false,
        blockers: [{ code: "supplier_required", lineIds: [] }],
        payable: {
          grossAmount: null,
          creditedAmount: null,
          amount: null,
          dueDate: null,
          dueDateSource: null,
        },
      }),
    );
    expect(html).not.toContain("Da pagare");
    expect(html).toContain("Collega il fornitore.");
  });
});

describe("ApproveConfirm (the second tap)", () => {
  const confirm = (over = {}) =>
    renderToStaticMarkup(
      createElement(ApproveConfirm, {
        approval: approval(),
        locationName: "Cella",
        busy: false,
        onConfirm: () => {},
        onCancel: () => {},
        ...over,
      }),
    );

  it("states the receipts and the amount, and that it cannot be undone", () => {
    const html = confirm();
    expect(html).toContain(
      `Registra 6 carichi e un debito di 1.234,50${NBSP}€. Non si può annullare.`,
    );
    expect(html).toContain("Ubicazione: Cella");
  });

  it("offers 'Conferma approvazione' as the one primary button, and 'Annulla'", () => {
    const html = confirm();
    expect(html).toMatch(/<button[^>]*>Conferma approvazione<\/button>/);
    expect(html).toMatch(/<button[^>]*>Annulla<\/button>/);
    expect(primaryButtons(html)).toHaveLength(1);
  });

  it("disables both buttons while the request is on its way", () => {
    const html = confirm({ busy: true });
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });
});

describe("ApprovalPanel once decided", () => {
  it("approved: the badge, the venue time and person, the posted payable, no button", () => {
    const html = render(decided());
    expect(html).toContain("Approvata");
    expect(html).toContain("il 22/10/2026, 10:12 da Titolare Demo");
    expect(html).toContain(`Da pagare 1.234,50${NBSP}€ entro il 29/10/2026`);
    expect(html).toContain("Ubicazione: Cella");
    expect(html).toMatch(
      /<p role="status"[^>]*>Carichi e debito registrati\. Non si può annullare\.<\/p>/,
    );
    expect(html).not.toContain("<button");
  });

  it("rejected: the badge and the reason, rendered as escaped text", () => {
    const html = render(
      decided({
        invoice: { ...makeReview().invoice, status: "rejected" },
        decision: {
          action: "rejected",
          at: "2026-10-22T08:12:00+00:00",
          byName: "Titolare Demo",
          reason: "<script>alert(1)</script>",
        },
        posting: null,
      }),
    );
    expect(html).toContain("Rifiutata");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<button");
  });

  it("rejected without a reason shows no reason line", () => {
    const html = render(
      decided({
        decision: { action: "rejected", at: "2026-10-22T08:12:00Z", byName: null, reason: null },
        posting: null,
      }),
    );
    expect(html).not.toContain("decision-reason");
    expect(html).toContain("il 22/10/2026, 10:12");
  });
});

describe("ApprovalPanel in the other states", () => {
  it("renders nothing while the invoice is being read, failed, or has no approval data", () => {
    expect(render(makeReview([], { approval: null, editable: false }))).toBe("");
  });

  it("a duplicate can only be rejected: no approve button", () => {
    const html = render(
      makeReview([], {
        editable: false,
        invoice: { ...makeReview().invoice, status: "duplicate" },
      }),
    );
    expect(html).toContain(">Rifiuta<");
    expect(html).not.toContain("Approva fattura");
  });
});

// UX plan B6: after an approval the panel offers the next steps, as links.
describe("ApprovalPanel after an approval: what to do next", () => {
  const link = (html: string, name: string) =>
    html.match(new RegExp(`<a[^>]*href="([^"]+)"[^>]*>${name}</a>`))?.[1] ?? null;

  it("offers the stock, the payment and the next invoice", () => {
    const html = render(decided());
    expect(link(html, "Vai al magazzino")).toBe("/magazzino");
    expect(link(html, "Vedi il pagamento")).toBe("/pagamenti");
    expect(link(html, "Prossima fattura")).toBe("/fatture");
  });

  it("offers only the next invoice after a rejection (nothing was booked)", () => {
    const html = render(
      decided({
        decision: {
          action: "rejected",
          at: "2026-10-22T08:12:00Z",
          byName: null,
          reason: "Errore",
        },
        posting: null,
      }),
    );
    expect(link(html, "Prossima fattura")).toBe("/fatture");
    expect(html).not.toContain("Vai al magazzino");
    expect(html).not.toContain("Vedi il pagamento");
  });

  it("shows none of them while the invoice is still in review", () => {
    const html = render(inReview());
    expect(html).not.toContain("Prossima fattura");
  });
});
