// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reencodeForUpload } from "@/lib/upload/reencode";
import { FatturaError } from "@/server/fatturapa/errors";
import { unsupportedFileType } from "@/server/invoices/file-check";
import { fatturaToApiError } from "@/server/invoices/xml-errors";

const apiUpload = vi.fn();
vi.mock("@/lib/api/client", async (original) => ({
  ...(await original<typeof import("@/lib/api/client")>()),
  apiUpload: (...args: unknown[]) => apiUpload(...args),
}));

import { UploadForm } from "@/app/(owner)/fatture/upload-form";

const ID_1 = "1b000000-0000-4000-8000-0000000000a1";
const ID_2 = "1b000000-0000-4000-8000-0000000000a2";
const onUploaded = vi.fn();

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "review",
  bodyIndex: 1,
  bodyCount: 1,
  number: "FT 12",
  invoiceDate: "1998-11-03",
  supplierName: "Fornitore Demo 1",
  grossTotal: 1234.5,
  duplicateOf: null,
  ...over,
});
const ok = (data: unknown, status = 201) => ({ ok: true, status, data });
const failed = (error: { code: string; message: string; details?: unknown }, status: number) => ({
  ok: false,
  status,
  error,
});
const asError = (e: { code: string; message: string; details?: unknown; status: number }) =>
  failed({ code: e.code, message: e.message, details: e.details }, e.status);

beforeEach(() => {
  apiUpload.mockReset();
  onUploaded.mockReset();
});
afterEach(() => cleanup());

function pick(name: string, type = "application/xml", size = 100) {
  render(createElement(UploadForm, { onUploaded }));
  const input = screen.getByLabelText(/Carica PDF, foto o file XML/) as HTMLInputElement;
  const file = new File([new Uint8Array(size)], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
  return { input, file };
}
const send = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Carica" }));
  });
};

describe("the file field", () => {
  it("is labelled for XML and accepts the e-invoice types besides PDF and photos", () => {
    render(createElement(UploadForm, { onUploaded }));
    const input = screen.getByLabelText(/Carica PDF, foto o file XML/);
    const accept = input.getAttribute("accept") ?? "";
    for (const part of [
      "application/pdf",
      "image/jpeg",
      "image/png",
      ".heic",
      ".xml",
      ".p7m",
      "application/xml",
      "text/xml",
      "application/pkcs7-mime",
    ]) {
      expect(accept).toContain(part);
    }
  });

  it("keeps the camera input to photos only", () => {
    render(createElement(UploadForm, { onUploaded }));
    const camera = screen.getByLabelText(/Scatta foto/);
    expect(camera.getAttribute("accept")).toBe("image/jpeg,image/png");
  });

  it("says in the hint that .xml and .xml.p7m files are taken, and keeps the HEIC sentence", () => {
    render(createElement(UploadForm, { onUploaded }));
    expect(
      screen.getByText(
        "PDF, JPEG, PNG o fattura elettronica (.xml o .xml.p7m), fino a 4 MB. Le foto iPhone (HEIC) vengono convertite in automatico.",
      ),
    ).toBeTruthy();
  });

  it("shows the Fattura elettronica chip for an e-invoice name, and none for a PDF", () => {
    pick("FT12.xml.p7m", "application/pkcs7-mime");
    expect(screen.getByTestId("e-invoice-chip").textContent).toBe("Fattura elettronica");
    cleanup();
    pick("fattura.pdf", "application/pdf");
    expect(screen.queryByTestId("e-invoice-chip")).toBeNull();
  });

  it("is one form, posted, with a single primary Carica", () => {
    render(createElement(UploadForm, { onUploaded }));
    const form = screen.getByRole("form", { name: "Carica una fattura" });
    expect(form.getAttribute("method")).toBe("post");
  });
});

describe("reencodeForUpload", () => {
  it("passes an XML or p7m file through unchanged", async () => {
    const xml = new File(["<a/>"], "FT12.xml", { type: "application/xml" });
    const p7m = new File(["x"], "FT12.xml.p7m", { type: "application/pkcs7-mime" });
    expect(await reencodeForUpload(xml)).toEqual({ ok: true, file: xml });
    expect(await reencodeForUpload(p7m)).toEqual({ ok: true, file: p7m });
  });
});

describe("sending an e-invoice", () => {
  it("says it is reading the file while the one request runs", async () => {
    let resolve: (value: unknown) => void = () => {};
    apiUpload.mockReturnValue(new Promise((r) => (resolve = r)));
    pick("FT12.xml");
    await send();
    expect(screen.getByRole("status").textContent).toBe("Caricamento e lettura del file…");
    const button = screen.getByRole("button", { name: "Carica" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await act(async () => resolve(ok({ invoice: { id: ID_1 }, invoices: [row(ID_1)] })));
  });

  it("keeps the old wording while a PDF goes up", async () => {
    apiUpload.mockReturnValue(new Promise(() => {}));
    pick("fattura.pdf", "application/pdf");
    await send();
    expect(screen.getByRole("status").textContent).toBe("Caricamento in corso…");
  });

  it("sends the file as it is, in one multipart request to /api/invoices", async () => {
    apiUpload.mockResolvedValue(ok({ invoice: { id: ID_1 }, invoices: [row(ID_1)] }));
    const { file } = pick("FT12.xml");
    await send();
    const [path, body] = apiUpload.mock.calls[0] as [string, FormData];
    expect(path).toBe("/api/invoices");
    expect(body.get("file")).toBeInstanceOf(File);
    expect((body.get("file") as File).name).toBe(file.name);
  });

  it("shows one invoice with its figures and a Controlla ora link, then resets the picker", async () => {
    apiUpload.mockResolvedValue(ok({ invoice: { id: ID_1 }, invoices: [row(ID_1)] }));
    pick("FT12.xml");
    await send();
    const note = await screen.findByText(/letta dal file XML/);
    expect(note.textContent).toBe(
      "Fattura FT 12 del 03/11/1998 · Fornitore Demo 1 · 1.234,50\u00a0€ letta dal file XML. Controllala e approvala.",
    );
    expect(note.closest("[role=status]")).not.toBeNull();
    const link = screen.getByRole("link", { name: "Controlla ora ›" });
    expect(link.getAttribute("href")).toBe(`/fatture/${ID_1}/revisione`);
    expect(screen.queryByTestId("e-invoice-chip")).toBeNull();
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the result so a screen reader hears it", async () => {
    apiUpload.mockResolvedValue(ok({ invoice: { id: ID_1 }, invoices: [row(ID_1)] }));
    pick("FT12.xml");
    await send();
    await screen.findByText(/letta dal file XML/);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("upload-result")));
  });

  it("shows a duplicate as already uploaded, with an Apri link", async () => {
    apiUpload.mockResolvedValue(
      ok({
        invoice: { id: ID_1 },
        invoices: [row(ID_1, { status: "duplicate", duplicateOf: ID_2 })],
      }),
    );
    pick("FT12.xml");
    await send();
    expect((await screen.findByText(/sembra già caricata/)).textContent).toBe(
      "Fattura letta, ma sembra già caricata (FT 12 del 03/11/1998). Aprila per decidere.",
    );
    expect(screen.getByRole("link", { name: "Apri ›" }).getAttribute("href")).toBe(
      `/fatture/${ID_1}/revisione`,
    );
  });

  it("lists the invoices of a multi-invoice file, each row a link with its status word", async () => {
    apiUpload.mockResolvedValue(
      ok({
        invoice: { id: ID_1 },
        invoices: [
          row(ID_1, { bodyCount: 2 }),
          row(ID_2, {
            bodyIndex: 2,
            bodyCount: 2,
            number: "FT 13",
            status: "duplicate",
            duplicateOf: ID_1,
          }),
        ],
      }),
    );
    pick("FT12.xml.p7m", "application/pkcs7-mime");
    await send();
    expect(await screen.findByText("Il file conteneva 2 fatture, tutte lette:")).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `/fatture/${ID_1}/revisione`,
      `/fatture/${ID_2}/revisione`,
    ]);
    expect(links[0]!.textContent).toContain("FT 12 del 03/11/1998 · 1.234,50\u00a0€");
    expect(links[0]!.textContent).toContain("Da controllare");
    expect(links[1]!.textContent).toContain("Sembra già caricata");
  });

  it("still says Fattura caricata for a PDF", async () => {
    apiUpload.mockResolvedValue(ok({ invoice: { id: ID_1 } }, 202));
    pick("fattura.pdf", "application/pdf");
    await send();
    expect((await screen.findByRole("status")).textContent).toBe("Fattura caricata.");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("refusals (every code, in a live region, nothing cleared)", () => {
  const fatt = (
    code: ConstructorParameters<typeof FatturaError>[0],
    reason: string,
    details = [],
  ) => asError(fatturaToApiError(new FatturaError(code, reason, details)));

  const cases: [string, ReturnType<typeof failed>, RegExp][] = [
    [
      "415",
      asError(unsupportedFileType()),
      /Formato non supportato: servono PDF, JPEG, PNG o fattura elettronica XML\/P7M\./,
    ],
    [
      "xml_unreadable",
      fatt("xml_unreadable", "x"),
      /Il file XML è danneggiato o non leggibile\. Scaricalo di nuovo e riprova\./,
    ],
    [
      "xml_not_fatturapa",
      fatt("xml_not_fatturapa", "x"),
      /Questo file XML non è una fattura elettronica\./,
    ],
    [
      "p7m_unreadable",
      fatt("p7m_unreadable", "x"),
      /Non riesco ad aprire il file firmato \(\.p7m\)\. Prova a caricare la versione \.xml della stessa fattura\./,
    ],
    [
      "xml_simplified_unsupported",
      fatt("xml_simplified_unsupported", "x"),
      /È una fattura semplificata: non ancora gestita\. Carica il PDF o una foto\./,
    ],
    [
      "TD04",
      fatt("xml_document_type_unsupported", "x", [
        { body: 1, code: "TD04", label: "Nota di credito" },
      ] as never),
      /È una nota di credito \(TD04\): Costì non la registra ancora\. Passala al commercialista\./,
    ],
    [
      "other document type",
      fatt("xml_document_type_unsupported", "x", [
        { body: 1, code: "TD16", label: "Integrazione" },
      ] as never),
      /Tipo di documento non gestito: Integrazione \(TD16\)\. Passalo al commercialista\./,
    ],
    [
      "withholding",
      fatt("xml_content_unsupported", "withholding"),
      /Fattura con ritenuta d'acconto o cassa previdenziale: non ancora gestita\./,
    ],
    [
      "currency",
      fatt("xml_content_unsupported", "currency"),
      /Fattura in una valuta diversa dall'euro: non gestita\./,
    ],
    [
      "split payment",
      fatt("xml_content_unsupported", "split_payment"),
      /Scissione dei pagamenti: riguarda solo la Pubblica Amministrazione\./,
    ],
    [
      "too many lines",
      fatt("xml_content_unsupported", "too_many_lines"),
      /La fattura ha più di 200 righe\./,
    ],
    [
      "too many bodies",
      fatt("xml_content_unsupported", "too_many_bodies"),
      /Il file contiene più di 10 fatture: chiedi file separati\./,
    ],
    [
      "invalid content",
      fatt("xml_invalid_content", "x", [{ body: 1, line: 3, field: "AliquotaIVA" }] as never),
      /Nel file mancano dati obbligatori o sono scritti male\./,
    ],
    [
      "not addressed",
      failed(
        {
          code: "xml_not_addressed_to_tenant",
          message: "Questa fattura è intestata a un'altra partita IVA, non al locale.",
        },
        422,
      ),
      /intestata a un'altra partita IVA, non al locale\./,
    ],
    [
      "issued by tenant",
      failed(
        {
          code: "xml_issued_by_tenant",
          message: "Questa fattura è emessa dal locale, non da un fornitore.",
        },
        422,
      ),
      /emessa dal locale, non da un fornitore\./,
    ],
    [
      "429",
      failed(
        { code: "rate_limited", message: "Troppi caricamenti nell'ultima ora. Riprova tra poco." },
        429,
      ),
      /Troppi caricamenti nell'ultima ora/,
    ],
    [
      "network",
      failed({ code: "network", message: "Connessione assente. Riprova." }, 0),
      /Connessione assente/,
    ],
  ];

  it.each(cases)("%s", async (_name, reply, text) => {
    apiUpload.mockResolvedValue(reply);
    pick("FT12.xml");
    await send();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(text);
    expect(onUploaded).not.toHaveBeenCalled();
    // The refused file stays shown, so the owner sees which one it was.
    expect(screen.getByText("File scelto: FT12.xml")).toBeTruthy();
  });

  it("lists the invalid places under the sentence, inside the alert", async () => {
    apiUpload.mockResolvedValue(
      fatt("xml_invalid_content", "x", [
        { body: 2, line: 3, field: "AliquotaIVA" },
        { body: 2, field: "IdFiscaleIVA" },
      ] as never),
    );
    pick("FT12.xml");
    await send();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nessuna fattura del file è stata salvata.");
    expect(alert.textContent).toContain("Fattura 2, riga 3: aliquota IVA");
    expect(alert.textContent).toContain("Fattura 2: partita IVA");
    expect(alert.querySelectorAll("li")).toHaveLength(2);
  });

  it("uses the XML wording for a 413 on an e-invoice and the server's for a PDF", async () => {
    apiUpload.mockResolvedValue(
      failed(
        { code: "payload_too_large", message: "Il file è troppo grande (massimo 4 MB)." },
        413,
      ),
    );
    pick("FT12.xml.p7m", "application/pkcs7-mime");
    await send();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Il file supera 4 MB\. Succede quando contiene un PDF allegato/,
    );
    cleanup();
    pick("fattura.pdf", "application/pdf");
    await send();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Il file è troppo grande (massimo 4 MB).",
    );
  });

  it("uses the XML wording for an e-invoice over the size limit picked on the phone, with no request", () => {
    pick("FT12.xml", "application/xml", 5 * 1024 * 1024);
    expect(screen.getByRole("alert").textContent).toMatch(
      /Succede quando contiene un PDF allegato/,
    );
    expect(apiUpload).not.toHaveBeenCalled();
  });

  it("renders Apri la fattura for a file already uploaded, linking the first invoice", async () => {
    apiUpload.mockResolvedValue(
      failed(
        {
          code: "already_uploaded",
          message: "Questo file è già stato caricato.",
          details: { invoiceId: ID_1 },
        },
        409,
      ),
    );
    pick("FT12.xml");
    await send();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Questo file è già stato caricato.",
    );
    expect(screen.getByRole("link", { name: "Apri la fattura ›" }).getAttribute("href")).toBe(
      `/fatture/${ID_1}`,
    );
  });

  it("a refusal replaces an earlier success", async () => {
    apiUpload.mockResolvedValueOnce(ok({ invoice: { id: ID_1 }, invoices: [row(ID_1)] }));
    pick("FT12.xml");
    await send();
    await screen.findByText(/letta dal file XML/);
    apiUpload.mockResolvedValueOnce(fatt("xml_unreadable", "x"));
    fireEvent.change(screen.getByLabelText(/Carica PDF, foto o file XML/), {
      target: { files: [new File(["x"], "B.xml", { type: "application/xml" })] },
    });
    await send();
    await screen.findByRole("alert");
    expect(screen.queryByText(/letta dal file XML/)).toBeNull();
  });
});
