import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReverseForm } from "@/app/(owner)/pagamenti/[id]/reverse-form";

const render = (defaultOpen = false, busy = false) =>
  renderToStaticMarkup(createElement(ReverseForm, { busy, defaultOpen, onSubmit: () => {} }));

describe("ReverseForm", () => {
  it("first shows only 'Annulla pagamento', as a secondary button, with no reason field", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*border-ink[^>]*>Annulla pagamento<\/button>/);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Conferma annullamento");
  });

  it("the second step asks for a required reason and says the payment stays in the history", () => {
    const html = render(true);
    expect(html).toMatch(/<label[^>]*>[\s\S]*Motivo[\s\S]*<input[^>]*required/);
    expect(html).toContain("Non inserire dati personali.");
    expect(html).toContain("resta nello storico");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Conferma annullamento<\/button>/);
  });

  it("caps the reason at 200 characters", () => {
    expect(render(true)).toContain('maxLength="200"');
  });

  it("disables the buttons while the request is on its way", () => {
    expect(render(true, true).match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });
});
