import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloseCount } from "@/app/(owner)/magazzino/conteggi/[id]/close-count";
import { SESSION_ID } from "./count-fixtures";

type Props = Parameters<typeof CloseCount>[0];
const noop = () => undefined;
const render = (props: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(CloseCount, {
      sessionId: SESSION_ID,
      linesCounted: 15,
      linesTotal: 20,
      linesWithDifference: 3,
      busy: false,
      closed: null,
      onClose: noop,
      onCancel: noop,
      ...props,
    }),
  );

describe("CloseCount", () => {
  it("shows the progress from the server's counters and one primary 'Chiudi conteggio'", () => {
    const html = render();
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>15 di 20 contati<\/p>/);
    expect(html.match(/ bg-accent /g)).toHaveLength(1);
    expect(html).toMatch(/bg-accent[^>]*>Chiudi conteggio</);
    expect(html).not.toContain("Conferma chiusura");
  });

  it("the second step states the server's numbers and that it cannot be undone", () => {
    const html = render({ defaultConfirmingClose: true });
    expect(html).toContain(
      "Verranno registrate 3 differenze. 5 ingredienti non contati restano invariati. Il conteggio non si può annullare.",
    );
    expect(html).toMatch(/>Conferma chiusura</);
  });

  it("uses the singular for one difference and one item, and omits the skipped sentence at zero", () => {
    expect(
      render({ defaultConfirmingClose: true, linesWithDifference: 1, linesCounted: 19 }),
    ).toContain("Verrà registrata 1 differenza. 1 ingrediente non contato resta invariato.");
    const none = render({ defaultConfirmingClose: true, linesCounted: 20, linesWithDifference: 0 });
    expect(none).toContain("Non verrà registrata nessuna differenza.");
    expect(none).not.toContain("non contat");
  });

  it("'Annulla conteggio' is a quiet button with its own confirmation", () => {
    const html = render();
    expect(html).toMatch(/text-accent-ink[^>]*>Annulla conteggio</);
    const confirming = render({ defaultConfirmingCancel: true });
    expect(confirming).toContain("Il conteggio verrà annullato. Nessuna quantità cambia.");
    expect(confirming).toMatch(/>Conferma annullamento</);
  });

  it("is disabled while busy", () => {
    expect(render({ busy: true })).toMatch(/disabled=""[^>]*>Chiudi conteggio</);
  });

  it("after closing: a status note with the count and a link to the variance, and no buttons", () => {
    const html = render({ closed: { linesWithDifference: 3 } });
    expect(html).toContain('role="status"');
    expect(html).toContain("Conteggio chiuso: 3 differenze registrate.");
    expect(html).toContain(`href="/magazzino/conteggi/${SESSION_ID}/scostamenti"`);
    expect(html).not.toContain("Chiudi conteggio");
    expect(render({ closed: { linesWithDifference: 1 } })).toContain(
      "Conteggio chiuso: 1 differenza registrata.",
    );
  });

  it("shows no euro sign", () => {
    expect(render()).not.toContain("€");
    expect(render({ closed: { linesWithDifference: 3 } })).not.toContain("€");
  });
});
