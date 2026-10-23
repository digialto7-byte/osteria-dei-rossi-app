import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestAlertCard } from "@/app/(owner)/avvisi/test-alert-card";

const render = (props: { busy?: boolean; result?: "created" | "deduplicated" | null } = {}) =>
  renderToStaticMarkup(
    createElement(TestAlertCard, { busy: false, result: null, onSend: () => {}, ...props }),
  );

describe("TestAlertCard", () => {
  it("has a heading and a labelled 'Anche alla cucina' checkbox", () => {
    const html = render();
    expect(html).toContain("Prova degli avvisi");
    expect(html).toMatch(
      /<label[^>]*>[\s\S]*<input[^>]*type="checkbox"[\s\S]*Anche alla cucina[\s\S]*<\/label>/,
    );
  });

  it("has one secondary button and no primary button", () => {
    const html = render();
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*border-ink[^>]*>Invia avviso di prova<\/button>/);
    expect(html).not.toMatch(/bg-accent/);
  });

  it("disables the button while sending", () => {
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled=""/);
  });

  it("announces the result in a status note", () => {
    expect(render({ result: "created" })).toMatch(/role="status"[^>]*>Avviso di prova creato\./);
    expect(render({ result: "deduplicated" })).toMatch(
      /role="status"[^>]*>Oggi hai già inviato questo avviso di prova\./,
    );
    expect(render()).not.toContain('role="status"');
  });

  it("never mentions email", () => {
    expect(render({ result: "created" })).not.toMatch(/e-?mail/i);
  });
});
