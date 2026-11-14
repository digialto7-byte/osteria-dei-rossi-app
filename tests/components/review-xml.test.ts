// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceReview } from "@/server/invoices/review-types";
import {
  lineXml,
  makeXmlReview,
  partner,
  PARTNER_ID,
  xmlInfo,
  xmlLine,
} from "../helpers/review-xml";

// P2-7 screen spec §5: the review of an XML e-invoice. The words are the spec's (Y1-Y10), the values are the review reply's.
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, message: string): Result => ({
  ok: false,
  status,
  error: { code, message },
});

let review: InvoiceReview;
let laptop = false;
let routes: Record<string, (options?: { method?: string; body?: unknown }) => Result> = {};
const apiJson = vi.fn(
  (path: string, options?: { method?: string; body?: unknown }): Promise<Result> => {
    const key = `${options?.method ?? "GET"} ${path}`;
    const handler = routes[key];
    if (handler) return Promise.resolve(handler(options));
    if (path.endsWith("/review")) return Promise.resolve(ok({ review }));
    if (path.startsWith("/api/ingredients")) return Promise.resolve(ok({ ingredients: [] }));
    if (path.startsWith("/api/cost-centres")) return Promise.resolve(ok({ costCentres: [] }));
    if (path.startsWith("/api/suppliers")) return Promise.resolve(ok({ suppliers: [] }));
    return Promise.resolve(fail(404, "not_found", "x"));
  },
);
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, options?: { method?: string; body?: unknown }) => apiJson(path, options),
}));
vi.mock("@/components/use-media-query", () => ({ useMediaQuery: () => laptop }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { DocumentPanel } from "@/app/(owner)/fatture/[id]/revisione/document-panel";
import { LineEditor } from "@/app/(owner)/fatture/[id]/revisione/line-editor";
import ReviewPage from "@/app/(owner)/fatture/[id]/revisione/page";
import { LineRow } from "@/app/(owner)/fatture/[id]/revisione/review-line";
import { ReviewHeader } from "@/app/(owner)/fatture/[id]/revisione/review-summary";
import { SupplierPanel } from "@/app/(owner)/fatture/[id]/revisione/supplier-panel";
import { XmlNotes } from "@/app/(owner)/fatture/[id]/revisione/xml-notes";
import { XmlSummary } from "@/app/(owner)/fatture/[id]/revisione/xml-summary";

const NBSP = " ";
const URL_1 = "https://storage.example.test/signed/FT12.xml?token=fake";
const scrollIntoView = vi.fn();

beforeEach(() => {
  laptop = false;
  routes = {};
  review = makeXmlReview();
  apiJson.mockClear();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(cleanup);

const ID = () => review.invoice.id;
async function openPage() {
  await act(async () => {
    render(
      createElement(
        Suspense,
        { fallback: null },
        createElement(ReviewPage, { params: Promise.resolve({ id: ID() }) }),
      ),
    );
  });
  await screen.findByRole("heading", { level: 1 });
}

describe("XmlSummary, the card that replaces the document", () => {
  const card = (r: InvoiceReview = review) =>
    render(createElement(XmlSummary, { review: r, download: createElement("span", null, "DL") }));

  it("shows the supplier, the facts and the VAT summary from the reply, and the label that is not an expiry", () => {
    card();
    expect(screen.getByRole("heading", { name: "Dati dal file XML" })).toBeTruthy();
    expect(screen.getByText("Fornitore Demo Srl")).toBeTruthy();
    expect(screen.getByText("P.IVA IT12345678903")).toBeTruthy();
    const facts = screen.getByTestId("xml-facts");
    expect(within(facts).getByText("Numero").nextElementSibling?.textContent).toBe("FT 12");
    expect(within(facts).getByText("Data").nextElementSibling?.textContent).toBe("03/11/1998");
    // Y4: the header label is not "Scadenza", which on this screen means a product expiry.
    expect(within(facts).getByText("Scadenza pagamento").nextElementSibling?.textContent).toBe(
      "03/12/1998",
    );
    expect(within(facts).queryByText("Scadenza", { exact: true })).toBeNull();
    expect(screen.getByRole("heading", { name: "Riepilogo IVA" })).toBeTruthy();
    const rows = screen.getAllByTestId("xml-vat-row").map((row) => row.textContent);
    expect(rows).toEqual([
      `22% · imponibile 100,00${NBSP}€ · IVA 22,00${NBSP}€`,
      `Esenti (N4) · imponibile 10,00${NBSP}€`,
    ]);
    expect(screen.getByText("Totale documento").nextElementSibling?.textContent).toBe(
      `132,00${NBSP}€`,
    );
  });

  it("says a missing due date is missing, never a blank or a guess", () => {
    card(makeXmlReview([], {}, {}, { dueDate: null }));
    expect(screen.getByText("Scadenza pagamento").nextElementSibling?.textContent).toBe(
      "Non indicata",
    );
  });

  it("is open by default on a phone and folds on the title button (44 px, aria-expanded)", () => {
    card();
    const toggle = screen.getByRole("button", { name: "Dati dal file XML" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.className).toContain("min-h-tap");
    expect(screen.getByTestId("xml-facts")).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("xml-facts")).toBeNull();
  });

  it("is always open on a laptop, with no toggle", () => {
    laptop = true;
    card();
    expect(screen.queryByRole("button", { name: "Dati dal file XML" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Dati dal file XML" })).toBeTruthy();
    expect(screen.getByTestId("xml-facts")).toBeTruthy();
  });

  it("is nothing for an invoice that has no XML data", () => {
    const { container } = card({ ...review, invoice: { ...review.invoice, xml: null } });
    expect(container.textContent).toBe("");
  });
});

describe("XmlNotes", () => {
  it("lists the notes with the server's words, under 'Nel file c'è anche'", () => {
    const r = makeXmlReview(
      [],
      {},
      {
        notes: [
          { code: "attachments", label: "Allegati nel file (non importati)" },
          { code: "document_discount", label: "Sconto sul totale documento: controlla il totale" },
        ],
      },
    );
    render(createElement(XmlNotes, { notes: r.invoice.xml!.notes }));
    expect(screen.getByRole("heading", { name: "Nel file c'è anche" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Allegati nel file (non importati)",
      "Sconto sul totale documento: controlla il totale",
    ]);
  });

  it("is absent when the file held nothing else, and never in a warning colour", () => {
    const { container } = render(createElement(XmlNotes, { notes: [] }));
    expect(container.textContent).toBe("");
    cleanup();
    const { container: filled } = render(
      createElement(XmlNotes, { notes: [{ code: "stamp_duty", label: "Bollo" }] }),
    );
    expect(filled.innerHTML).not.toContain("warning");
    expect(filled.innerHTML).not.toContain("danger");
  });
});

describe("DocumentPanel for an XML invoice", () => {
  const open = async (r: InvoiceReview = review) => {
    await act(async () => {
      render(
        createElement(DocumentPanel, {
          invoiceId: r.invoice.id,
          mime: r.invoice.fileMime,
          review: r,
        }),
      );
    });
  };

  it("never frames the file: no iframe and no image, on a laptop either", async () => {
    laptop = true;
    routes[`GET /api/invoices/${ID()}/file-url`] = () =>
      ok({ url: URL_1, expiresAt: "1998-11-03T10:05:00Z", disposition: "attachment" });
    await open();
    await screen.findByRole("link", { name: "Scarica il file originale (XML)" });
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("asks for the signed link once and offers it as a download, naming the type", async () => {
    routes[`GET /api/invoices/${ID()}/file-url`] = () =>
      ok({ url: URL_1, expiresAt: "1998-11-03T10:05:00Z", disposition: "attachment" });
    await open();
    const link = await screen.findByRole("link", { name: "Scarica il file originale (XML)" });
    expect(link.getAttribute("href")).toBe(URL_1);
    expect(link.hasAttribute("download")).toBe(true);
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.className).toContain("min-h-tap");
    expect(link.textContent).toBe("Scarica il file originale ›");
    expect(apiJson.mock.calls.filter(([p]) => String(p).endsWith("/file-url"))).toHaveLength(1);
  });

  it("names a signed file P7M", async () => {
    review = makeXmlReview([], {}, { signed: true });
    routes[`GET /api/invoices/${ID()}/file-url`] = () =>
      ok({ url: URL_1, expiresAt: "1998-11-03T10:05:00Z", disposition: "attachment" });
    await open();
    expect(
      await screen.findByRole("link", { name: "Scarica il file originale (P7M firmato)" }),
    ).toBeTruthy();
  });

  it("says Caricamento… until the link arrives", async () => {
    let release: (value: Result) => void = () => {};
    apiJson.mockImplementationOnce(() => new Promise<Result>((resolve) => (release = resolve)));
    await open();
    expect(screen.getByText("Caricamento…")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    await act(async () =>
      release(ok({ url: URL_1, expiresAt: "1998-11-03T10:05:00Z", disposition: "attachment" })),
    );
    expect(screen.getByRole("link", { name: /Scarica il file originale/ })).toBeTruthy();
  });

  it("shows the error and Ricarica documento when the link cannot be read, and tries again on the tap", async () => {
    routes[`GET /api/invoices/${ID()}/file-url`] = () =>
      fail(502, "upstream_error", "Archivio non raggiungibile.");
    await open();
    expect((await screen.findByRole("alert")).textContent).toBe("Archivio non raggiungibile.");
    expect(screen.queryByRole("link")).toBeNull();
    routes[`GET /api/invoices/${ID()}/file-url`] = () =>
      ok({ url: URL_1, expiresAt: "1998-11-03T10:05:00Z", disposition: "attachment" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ricarica documento" }));
    });
    expect(screen.getByRole("link", { name: /Scarica il file originale/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the notes card only when the file held something else", async () => {
    routes[`GET /api/invoices/${ID()}/file-url`] = () =>
      ok({ url: URL_1, expiresAt: "1998-11-03T10:05:00Z", disposition: "attachment" });
    await open();
    expect(screen.queryByRole("heading", { name: "Nel file c'è anche" })).toBeNull();
    cleanup();
    review = makeXmlReview(
      [],
      {},
      { notes: [{ code: "stamp_duty", label: "Bollo indicato nel file (non importato)" }] },
    );
    await open();
    expect(screen.getByRole("heading", { name: "Nel file c'è anche" })).toBeTruthy();
  });

  it("still frames a PDF as before (a laptop shows the iframe)", async () => {
    laptop = true;
    const pdf = {
      ...makeXmlReview(),
      invoice: { ...makeXmlReview().invoice, xml: null, fileMime: "application/pdf" },
    };
    routes[`GET /api/invoices/${ID()}/file-url`] = () =>
      ok({ url: URL_1, expiresAt: "1998-11-03T10:05:00Z", disposition: "inline" });
    await act(async () => {
      render(
        createElement(DocumentPanel, {
          invoiceId: pdf.invoice.id,
          mime: "application/pdf",
          review: pdf,
        }),
      );
    });
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  });
});

describe("ReviewHeader for an XML invoice", () => {
  it("calls the due date 'Scadenza pagamento' and leaves 'Scadenza' to a product expiry (Y4)", () => {
    render(createElement(ReviewHeader, { review }));
    expect(screen.getByText("Scadenza pagamento")).toBeTruthy();
    expect(screen.queryByText("Scadenza", { exact: true })).toBeNull();
  });

  it("keeps 'Scadenza' for a photo or a PDF", () => {
    const pdf = { ...review, invoice: { ...review.invoice, xml: null } };
    render(createElement(ReviewHeader, { review: pdf }));
    expect(screen.getByText("Scadenza")).toBeTruthy();
  });
});

describe("LineRow for an XML line", () => {
  const row = (line = xmlLine(), props: Partial<Parameters<typeof LineRow>[0]> = {}) =>
    render(createElement(LineRow, { line, ...props }));

  it("shows the first code with the hint on the first line that has one only", () => {
    const line = xmlLine({}, { codes: [{ type: "EAN", value: "8000000000001" }] });
    row(line, { codeHint: true });
    expect(screen.getByText("Cod. EAN 8000000000001")).toBeTruthy();
    expect(screen.getByText("usato per riconoscere l'articolo")).toBeTruthy();
    cleanup();
    row(line, { codeHint: false });
    expect(screen.getByText("Cod. EAN 8000000000001")).toBeTruthy();
    expect(screen.queryByText("usato per riconoscere l'articolo")).toBeNull();
  });

  it("shows the price before discounts and the kind of a special line", () => {
    row(
      xmlLine(
        { vatRate: 22 },
        {
          kind: "residual",
          listUnitPrice: 10,
          discounts: [{ type: "SC", percent: 10, amount: null }],
        },
      ),
    );
    expect(screen.getByText(/^Prezzo 10,00\s€ − sconto 10%$/)).toBeTruthy();
    expect(screen.getByText("Differenza dal riepilogo IVA 22%")).toBeTruthy();
  });

  it("is unchanged for a line with no file data", () => {
    row(xmlLine({ xml: null }));
    expect(screen.queryByText(/Cod\./)).toBeNull();
    expect(screen.queryByText("Dal fornitore")).toBeNull();
  });

  describe("Dal fornitore", () => {
    const lot = lineXml({
      otherData: [
        { type: "LOTTO", text: "L-DEMO-0001", number: null, date: null },
        { type: "SCAD", text: null, number: null, date: "1998-12-01" },
        { type: "PESO", text: null, number: 12.5, date: null },
      ],
    });
    const withData = (over = {}) => ({ ...xmlLine({ lotMissing: true, ...over }), xml: lot });

    it("lists the supplier's own labels and values, with the two copy buttons and none for a number", () => {
      row(withData(), { saveLine: async () => null });
      expect(screen.getByText("Dal fornitore")).toBeTruthy();
      expect(screen.getByText("LOTTO")).toBeTruthy();
      expect(screen.getByText("L-DEMO-0001")).toBeTruthy();
      expect(screen.getByText("01/12/1998")).toBeTruthy();
      expect(screen.getByText("12,5")).toBeTruthy();
      expect(screen.getAllByRole("button", { name: "Usa come lotto" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Usa come scadenza" })).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Usa come lotto" }).className).toContain(
        "min-h-tap",
      );
    });

    it("'Usa come lotto' sends exactly the lot code, shows Salvataggio… and then 'Lotto copiato.'", async () => {
      let finish: (value: string | null) => void = () => {};
      const saveLine = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
      row(withData(), { saveLine });
      fireEvent.click(screen.getByRole("button", { name: "Usa come lotto" }));
      expect(saveLine).toHaveBeenCalledWith(xmlLine().id, { lotCode: "L-DEMO-0001" });
      expect(screen.getByRole("button", { name: "Salvataggio…" }).hasAttribute("disabled")).toBe(
        true,
      );
      await act(async () => finish(null));
      expect(screen.getByRole("status").textContent).toBe("Lotto copiato.");
      expect(screen.queryByRole("button", { name: "Usa come lotto" })).toBeNull();
    });

    it("'Usa come scadenza' sends exactly the expiry date", async () => {
      const saveLine = vi.fn(async () => null);
      row(withData(), { saveLine });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Usa come scadenza" }));
      });
      expect(saveLine).toHaveBeenCalledWith(xmlLine().id, { expiry: "1998-12-01" });
      expect(screen.getByRole("status").textContent).toBe("Scadenza copiata.");
    });

    it("shows the refusal under the button and gives the button back", async () => {
      row(withData(), { saveLine: async () => "La fattura non è più in revisione." });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Usa come lotto" }));
      });
      expect(screen.getByRole("alert").textContent).toBe("La fattura non è più in revisione.");
      expect(screen.getByRole("button", { name: "Usa come lotto" }).hasAttribute("disabled")).toBe(
        false,
      );
    });

    it("shows the lot the line has and offers to replace it (Y8)", () => {
      row(withData({ lotCode: "L-OLD", lotMissing: false }), { saveLine: async () => null });
      expect(screen.getByText("Lotto attuale: L-OLD")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Usa come lotto" })).toBeNull();
      expect(screen.getByRole("button", { name: "Sostituisci con questo lotto" })).toBeTruthy();
    });

    it("says copied, with no button, when the line already holds the file's value", () => {
      row(withData({ lotCode: "L-DEMO-0001", lotMissing: false }), { saveLine: async () => null });
      expect(screen.getByText("Lotto copiato.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /lotto/i })).toBeNull();
    });

    it("shows the current expiry and offers to replace it", () => {
      row(withData({ expiry: "1999-01-15" }), { saveLine: async () => null });
      expect(screen.getByText("Scadenza attuale: 15/01/1999")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sostituisci con questa scadenza" })).toBeTruthy();
    });

    it("offers no button for a text over 64 characters", () => {
      const long = xmlLine(
        {},
        { otherData: [{ type: "LOTTO", text: "L".repeat(65), number: null, date: null }] },
      );
      row(long, { saveLine: async () => null });
      expect(screen.getByText("Troppo lungo per un lotto")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("offers no button on a read-only invoice, but still shows the values", () => {
      row(withData());
      expect(screen.getByText("L-DEMO-0001")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Usa come lotto" })).toBeNull();
    });
  });
});

describe("LineEditor on an XML line", () => {
  const actions = {
    saveLine: async () => null,
    createCentre: async () => ({ id: "c" }),
    split: async () => null,
    unsplit: async () => null,
  };
  const editor = (line = xmlLine()) =>
    render(
      createElement(LineEditor, {
        line,
        ingredients: [],
        costCentres: [],
        actions,
        onClose: () => {},
      }),
    );

  it("says the values come from the file and should be changed only if the supplier was wrong", () => {
    editor();
    expect(
      screen.getByText("Dal file XML: cambialo solo se il fornitore ha sbagliato."),
    ).toBeTruthy();
  });

  it("does not say it for a photo line", () => {
    editor(xmlLine({ xml: null }));
    expect(screen.queryByText(/Dal file XML/)).toBeNull();
  });
});

describe("SupplierPanel for an XML invoice with no supplier yet", () => {
  const actions = { link: vi.fn(async () => null), create: vi.fn(async () => null) };
  const unknown = (supplierVat = "IT12345678903") =>
    makeXmlReview(
      [],
      {
        supplier: null,
        extractedSupplier: { name: "Fornitore Demo 3", vatNumber: supplierVat, paymentTerms: null },
      },
      {},
      { supplierId: null, supplierName: "Fornitore Demo 3", supplierVat },
    );
  const panel = (
    r: InvoiceReview,
    suppliers = [{ id: "s1", name: "Altro Demo", vatNumber: null }],
  ) => render(createElement(SupplierPanel, { review: r, suppliers, actions }));

  beforeEach(() => {
    actions.link.mockClear();
    actions.create.mockClear();
  });

  it("names the new supplier from the file, with its VAT and where it comes from", () => {
    panel(unknown());
    expect(screen.getByText("Fornitore nuovo: Fornitore Demo 3")).toBeTruthy();
    expect(screen.getByText("P.IVA IT12345678903 · dal file XML")).toBeTruthy();
    expect(
      screen.getByText("Collega il fornitore: gli abbinamenti delle righe sono per fornitore."),
    ).toBeTruthy();
  });

  it("opens the create form on the tap, prefilled, with the file's own hint", () => {
    panel(unknown());
    expect(screen.queryByRole("form", { name: "Crea fornitore" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Crea fornitore" }));
    const form = screen.getByRole("form", { name: "Crea fornitore" });
    expect(
      within(form).getByText("Dati letti dal file XML: controllali prima di creare."),
    ).toBeTruthy();
    expect((within(form).getByLabelText(/^Nome/) as HTMLInputElement).value).toBe(
      "Fornitore Demo 3",
    );
    expect((within(form).getByLabelText(/^Partita IVA/) as HTMLInputElement).value).toBe(
      "IT12345678903",
    );
    expect(within(form).getByLabelText(/Pagamento/)).toBeTruthy();
  });

  it("leaves the VAT empty for a foreign supplier and says it stays on the invoice", () => {
    panel(unknown("DE123456789"));
    expect(screen.getByText("P.IVA DE123456789 · dal file XML")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Crea fornitore" }));
    const form = screen.getByRole("form", { name: "Crea fornitore" });
    expect((within(form).getByLabelText(/^Partita IVA/) as HTMLInputElement).value).toBe("");
    expect(within(form).getByText("La partita IVA estera resta sulla fattura.")).toBeTruthy();
  });

  it("offers an existing supplier through a second tap", () => {
    panel(unknown());
    expect(screen.queryByRole("button", { name: "Collega" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collega un fornitore esistente ›" }));
    expect(screen.getByRole("option", { name: "Altro Demo" })).toBeTruthy();
  });

  it("keeps the old panel for a photo with no supplier", () => {
    const photo = { ...unknown(), invoice: { ...unknown().invoice, xml: null } };
    panel(photo);
    expect(screen.queryByText(/Fornitore nuovo/)).toBeNull();
    expect(screen.getByRole("form", { name: "Crea fornitore" })).toBeTruthy();
  });
});

describe("the review page for an XML invoice", () => {
  const fileUrl = () =>
    ok({ url: URL_1, expiresAt: "1998-11-03T10:05:00Z", disposition: "attachment" });
  beforeEach(() => {
    routes = { [`GET /api/invoices/${review.invoice.id}/file-url`]: fileUrl };
  });

  it("shows the chips, the data card instead of a document, 'Righe dal file XML' once, and one primary at most", async () => {
    review = makeXmlReview(
      [
        xmlLine({ id: "11000000-0000-4000-8000-0000000000a1" }),
        xmlLine({ id: "11000000-0000-4000-8000-0000000000a2", rawDescription: "Farina Demo" }),
      ],
      {},
      { bodyIndex: 2, bodyCount: 3, signed: true },
    );
    routes[`GET /api/invoices/${ID()}/file-url`] = fileUrl;
    await openPage();
    expect(screen.getByText("Fattura elettronica · Fattura (TD01)")).toBeTruthy();
    expect(screen.getByText("Fattura 2 di 3 nello stesso file")).toBeTruthy();
    expect(screen.getByText("File firmato (firma non verificata da Costì)")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dati dal file XML" })).toBeTruthy();
    expect(screen.getAllByText("Righe dal file XML")).toHaveLength(1);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("copies a lot with a PATCH of exactly {lotCode} and reloads the review", async () => {
    const lineId = "11000000-0000-4000-8000-0000000000a1";
    review = makeXmlReview([
      xmlLine(
        { id: lineId, lotMissing: true },
        { otherData: [{ type: "LOTTO", text: "L-DEMO-0001", number: null, date: null }] },
      ),
    ]);
    const patch = vi.fn((_options?: { body?: unknown }) => {
      review = makeXmlReview([{ ...review.lines[0]!, lotCode: "L-DEMO-0001", lotMissing: false }]);
      return ok({ review });
    });
    routes[`PATCH /api/invoices/${ID()}/lines/${lineId}`] = patch;
    routes[`GET /api/invoices/${ID()}/file-url`] = fileUrl;
    await openPage();
    expect(screen.getByText("Lotto mancante")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Usa come lotto" }));
    });
    expect(patch.mock.calls[0]![0]!.body).toEqual({ lotCode: "L-DEMO-0001" });
    await waitFor(() => expect(screen.queryByText("Lotto mancante")).toBeNull());
    expect(screen.getByText("Lotto copiato.")).toBeTruthy();
  });

  it("shows the supplier panel's new-supplier text for an unknown supplier", async () => {
    review = makeXmlReview([], { supplier: null }, {}, { supplierId: null });
    routes[`GET /api/invoices/${ID()}/file-url`] = fileUrl;
    await openPage();
    expect(screen.getByText(/Fornitore nuovo:/)).toBeTruthy();
  });

  describe("duplicate banners", () => {
    const banner = (
      partnerOver: Parameters<typeof partner>[0],
      { xml = true, replace = false }: { xml?: boolean; replace?: boolean } = {},
    ) => {
      const base = makeXmlReview([xmlLine()], {
        duplicatePartner: partner(partnerOver),
        replaceWithXml: replace ? { partnerId: PARTNER_ID } : null,
        approval: null,
      });
      review = {
        ...base,
        invoice: {
          ...base.invoice,
          status: xml ? "duplicate" : "review",
          xml: xml ? base.invoice.xml : null,
          fileMime: xml ? "application/xml" : "application/pdf",
        },
      };
      routes[`GET /api/invoices/${ID()}/file-url`] = fileUrl;
    };
    const region = () => screen.getByTestId("duplicate-banner");

    it("1: shows the replace button as the primary, the other two choices below it", async () => {
      banner({ format: "document", status: "review" }, { replace: true });
      await openPage();
      const box = within(region());
      expect(
        box.getByText("Questa fattura è già presente da foto/PDF (da controllare)."),
      ).toBeTruthy();
      expect(box.getByRole("link", { name: "FT 12 del 03/11/1998 ›" }).getAttribute("href")).toBe(
        `/fatture/${PARTNER_ID}`,
      );
      expect(box.getByText("Importi uguali.")).toBeTruthy();
      const primary = box.getByRole("button", { name: "Usa il file XML al posto del PDF" });
      expect(primary.className).toContain("bg-accent");
      expect(box.getByRole("button", { name: "Non è un doppione" })).toBeTruthy();
      expect(box.getByRole("button", { name: "Rifiuta questo file" }).className).not.toContain(
        "bg-accent",
      );
      // The banner is above the data card, and replaces the generic duplicate area.
      expect(screen.queryByRole("button", { name: /Non è un doppione di/ })).toBeNull();
      const card = screen.getByRole("heading", { name: "Dati dal file XML" });
      expect(
        region().compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("2: an approved photo leaves only 'Rifiuta questo file', saying the file stays archived", async () => {
      banner({ format: "document", status: "approved", amountsMatch: false, grossTotal: 1230 });
      await openPage();
      const box = within(region());
      expect(box.getByText("Già approvata da foto/PDF.")).toBeTruthy();
      expect(
        box.getByText(/^Importi diversi: 132,00\s€ qui, 1\.230,00\s€ approvati\.$/),
      ).toBeTruthy();
      expect(box.getByRole("button", { name: "Rifiuta questo file" }).className).toContain(
        "bg-accent",
      );
      expect(box.getByText("Il file resta in archivio.")).toBeTruthy();
      expect(box.queryByRole("button", { name: "Non è un doppione" })).toBeNull();
      expect(box.queryByRole("button", { name: /Usa il file XML/ })).toBeNull();
    });

    it("3: a photo with an XML twin is rejected as a copy", async () => {
      banner({ format: "xml", status: "review" }, { xml: false });
      await openPage();
      const box = within(region());
      expect(box.getByText("Esiste già il file XML di questa fattura.")).toBeTruthy();
      expect(box.getByRole("button", { name: "Rifiuta questa copia" })).toBeTruthy();
      expect(box.getByRole("button", { name: "Non è un doppione" })).toBeTruthy();
    });

    it("4: an XML with an XML twin is rejected", async () => {
      banner({ format: "xml", status: "review" });
      await openPage();
      const box = within(region());
      expect(box.getByText("Doppione di un altro file XML.")).toBeTruthy();
      expect(box.getByRole("button", { name: "Rifiuta" })).toBeTruthy();
    });

    it("'Non è un doppione' sends the partner's id", async () => {
      banner({ format: "xml", status: "review" });
      const post = vi.fn(() => ok({ review }));
      routes[`POST /api/invoices/${ID()}/not-duplicate`] = post;
      await openPage();
      await act(async () => {
        fireEvent.click(within(region()).getByRole("button", { name: "Non è un doppione" }));
      });
      expect((post.mock.calls[0] as unknown as [{ body: unknown }])[0].body).toEqual({
        partnerId: PARTNER_ID,
      });
    });

    it("'Rifiuta' opens the reject form in place, and the confirmation rejects", async () => {
      banner({ format: "xml", status: "review" });
      const post = vi.fn(() => ok({ review, status: "rejected" }));
      routes[`POST /api/invoices/${ID()}/reject`] = post;
      await openPage();
      await act(async () => {
        fireEvent.click(within(region()).getByRole("button", { name: "Rifiuta" }));
      });
      const form = within(region()).getByRole("form", { name: "Rifiuta la fattura" });
      await act(async () => {
        fireEvent.click(within(form).getByRole("button", { name: "Conferma rifiuto" }));
      });
      expect(post).toHaveBeenCalledTimes(1);
    });

    describe("replace sheet", () => {
      const open = async () => {
        banner({ format: "document", status: "review" }, { replace: true });
        await openPage();
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Usa il file XML al posto del PDF" }));
        });
      };

      it("asks first, in place, saying what happens to the photo copy and to the mappings", async () => {
        await open();
        const sheet = screen.getByRole("group", { name: "Usare il file XML?" });
        expect(
          within(sheet).getByText(/La copia da foto\/PDF verrà rifiutata e resterà in archivio\./),
        ).toBeTruthy();
        expect(
          within(sheet).getByText(
            /Gli abbinamenti già memorizzati per il fornitore valgono anche per le righe del file XML, se codice o descrizione coincidono\./,
          ),
        ).toBeTruthy();
        expect(within(sheet).getByRole("button", { name: "Usa il file XML" }).className).toContain(
          "bg-accent",
        );
        expect(apiJson.mock.calls.some(([, o]) => o?.method === "POST")).toBe(false);
        fireEvent.click(within(sheet).getByRole("button", { name: "Annulla" }));
        expect(screen.queryByRole("group", { name: "Usare il file XML?" })).toBeNull();
      });

      it("sends exactly {replaces}, reloads, and says the XML is now the one to check", async () => {
        const post = vi.fn(() => {
          const base = makeXmlReview([xmlLine()], { duplicatePartner: null });
          review = { ...base, invoice: { ...base.invoice, status: "review" } };
          return ok({ status: "review" });
        });
        await open();
        routes[`POST /api/invoices/${ID()}/use-xml`] = post;
        const sheet = screen.getByRole("group", { name: "Usare il file XML?" });
        await act(async () => {
          fireEvent.click(within(sheet).getByRole("button", { name: "Usa il file XML" }));
        });
        expect((post.mock.calls[0] as unknown as [{ body: unknown }])[0].body).toEqual({
          replaces: PARTNER_ID,
        });
        await waitFor(() => expect(screen.queryByTestId("duplicate-banner")).toBeNull());
        expect(screen.getByRole("status", { name: "" }).textContent).toBe(
          "Ora questa è la fattura da controllare. La copia da foto/PDF è stata rifiutata.",
        );
      });

      it("does not claim success when another look-alike keeps the invoice a duplicate", async () => {
        await open();
        routes[`POST /api/invoices/${ID()}/use-xml`] = () => ok({ status: "duplicate" });
        const sheet = screen.getByRole("group", { name: "Usare il file XML?" });
        await act(async () => {
          fireEvent.click(within(sheet).getByRole("button", { name: "Usa il file XML" }));
        });
        expect(screen.queryByText(/Ora questa è la fattura da controllare/)).toBeNull();
      });

      it("on a 409 says the situation changed and reloads the review", async () => {
        await open();
        routes[`POST /api/invoices/${ID()}/use-xml`] = () =>
          fail(409, "replace_not_allowed", "Non si può sostituire.");
        const reads = () =>
          apiJson.mock.calls.filter(([p]) => String(p).endsWith("/review")).length;
        const before = reads();
        const sheet = screen.getByRole("group", { name: "Usare il file XML?" });
        await act(async () => {
          fireEvent.click(within(sheet).getByRole("button", { name: "Usa il file XML" }));
        });
        expect(
          screen
            .getByText("La situazione è cambiata: ricarico la fattura.")
            .closest("[role=status]"),
        ).not.toBeNull();
        expect(reads()).toBe(before + 1);
      });

      it("shows any other failure next to the button and keeps the sheet", async () => {
        await open();
        routes[`POST /api/invoices/${ID()}/use-xml`] = () =>
          fail(500, "internal", "Errore del server.");
        const sheet = screen.getByRole("group", { name: "Usare il file XML?" });
        await act(async () => {
          fireEvent.click(within(sheet).getByRole("button", { name: "Usa il file XML" }));
        });
        expect(within(sheet).getByRole("alert").textContent).toBe("Errore del server.");
      });

      it("disables the button and says Salvataggio… while the request is on its way", async () => {
        await open();
        let release: (value: Result) => void = () => {};
        const pending = new Promise<Result>((resolve) => (release = resolve));
        apiJson.mockImplementationOnce(() => pending);
        const sheet = screen.getByRole("group", { name: "Usare il file XML?" });
        await act(async () => {
          fireEvent.click(within(sheet).getByRole("button", { name: "Usa il file XML" }));
        });
        const busy = within(sheet).getByRole("button", { name: "Salvataggio…" });
        expect(busy.hasAttribute("disabled")).toBe(true);
        await act(async () => release(fail(500, "internal", "x")));
      });
    });
  });
});

describe("a photo review is unchanged", () => {
  it("shows no XML card, no chips and the generic duplicate action", async () => {
    const base = makeXmlReview([xmlLine({ xml: null })], {
      duplicatePartner: partner({ format: "document", status: "review" }),
    });
    review = {
      ...base,
      invoice: { ...base.invoice, status: "duplicate", xml: null, fileMime: "application/pdf" },
    };
    await openPage();
    expect(screen.queryByRole("heading", { name: "Dati dal file XML" })).toBeNull();
    expect(screen.queryByText(/Fattura elettronica/)).toBeNull();
    expect(screen.queryByTestId("duplicate-banner")).toBeNull();
    expect(screen.getByRole("button", { name: /Non è un doppione di FT 12/ })).toBeTruthy();
  });
});

void xmlInfo;
