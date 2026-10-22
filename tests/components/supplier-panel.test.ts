import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RelinkConfirm, SupplierPanel } from "@/app/(owner)/fatture/[id]/revisione/supplier-panel";
import { makeReview } from "../helpers/review-line";

const actions = { link: async () => null, create: async () => null };
const suppliers = [
  { id: "s1", name: "Fornitore Demo Srl", vatNumber: "IT12345678903" },
  { id: "s2", name: "Ortofrutta Esempio", vatNumber: null },
];

const panel = (review = makeReview()) =>
  renderToStaticMarkup(createElement(SupplierPanel, { review, suppliers, actions } as never));

const unlinked = (over = {}) =>
  makeReview([], {
    supplier: null,
    extractedSupplier: {
      name: "Fornitore Demo Srl",
      vatNumber: "IT12345678903",
      paymentTerms: null,
    },
    ...over,
  });

describe("SupplierPanel", () => {
  it("with no link, 'Crea fornitore' is prefilled with the extracted name and VAT", () => {
    const html = panel(unlinked());
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Crea fornitore</);
    expect(html).toContain('value="Fornitore Demo Srl"');
    expect(html).toContain('value="IT12345678903"');
  });

  it("escapes what the document printed before it lands in an input value", () => {
    const html = panel(
      unlinked({
        extractedSupplier: { name: '"><script>x</script>', vatNumber: null, paymentTerms: null },
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("lists the existing suppliers to link, and suggests a name match", () => {
    const html = panel(unlinked({ supplierSuggestion: { id: "s2", name: "Ortofrutta Esempio" } }));
    expect(html).toContain("Ortofrutta Esempio");
    expect(html).toMatch(/<button[^>]*>Collega</);
  });

  it("every control sits inside a label", () => {
    const html = panel(unlinked());
    expect(html.replace(/<label[\s\S]*?<\/label>/g, "")).not.toMatch(/<(input|select)\b/);
  });

  it("with a linked supplier it shows the name and only a 'Cambia fornitore' button", () => {
    const html = panel();
    expect(html).toContain("Fornitore Demo Srl");
    expect(html).toContain("Cambia fornitore");
    expect(html).not.toContain("Conferma");
    expect(html).not.toContain("Crea fornitore");
  });

  it("changing the link first warns that the mappings will be cleared, then needs 'Conferma'", () => {
    const html = renderToStaticMarkup(
      createElement(RelinkConfirm, {
        suppliers,
        currentId: "s1",
        actions,
        onClose: () => undefined,
      } as never),
    );
    expect(html).toContain("gli abbinamenti delle righe verranno cancellati");
    expect(html).toMatch(/<button[^>]*>Conferma</);
    expect(html.match(/bg-accent text-on-accent/g)).toHaveLength(1);
    // The supplier already linked is not offered again.
    expect(html).not.toContain('value="s1"');
    expect(html).toContain('value="s2"');
  });

  it("a read-only invoice shows the supplier without any control", () => {
    const html = panel(makeReview([], { editable: false }));
    expect(html).not.toContain("<button");
  });
});
