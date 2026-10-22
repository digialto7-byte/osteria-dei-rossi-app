import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RejectForm } from "@/app/(owner)/fatture/[id]/revisione/reject-form";

const render = (busy = false) =>
  renderToStaticMarkup(createElement(RejectForm, { busy, onSubmit: () => {}, onCancel: () => {} }));

describe("RejectForm", () => {
  it("the reason sits in a labelled Field with the no-personal-data hint", () => {
    const html = render();
    expect(html).toMatch(/<label[^>]*>[\s\S]*Motivo \(facoltativo\)[\s\S]*<input[\s\S]*<\/label>/);
    expect(html).toContain("Non inserire dati personali.");
    expect(html.replace(/<label[\s\S]*?<\/label>/g, "")).not.toMatch(/<input\b/);
  });

  it("caps the reason at 200 characters in the field itself", () => {
    expect(render()).toContain('maxLength="200"');
  });

  it("says a rejection is final", () => {
    expect(render()).toContain("Una fattura rifiutata non si riapre");
  });

  it("'Conferma rifiuto' submits and is the one primary button; 'Annulla' is quiet", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Conferma rifiuto<\/button>/);
    expect(html.match(/<button[^>]*bg-accent[^>]*>/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*>Annulla<\/button>/);
  });

  it("disables both buttons while the request is on its way", () => {
    expect(render(true).match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });
});
