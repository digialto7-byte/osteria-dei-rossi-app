import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StartCount } from "@/app/(owner)/magazzino/conteggi/start-count";
import type { CountSession } from "@/server/counts/types";
import { CELLA, FREEZER, SESSION, SESSION_ID } from "./count-fixtures";

const OPEN: CountSession = {
  ...SESSION,
  status: "open",
  closedAt: null,
  closedBy: null,
  linesTotal: 20,
  linesCounted: 12,
};
const noop = () => undefined;
const render = (props: Partial<Parameters<typeof StartCount>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(StartCount, {
      openSession: null,
      locations: [{ id: CELLA, name: "Cella (demo)" }],
      busy: false,
      onStart: noop,
      ...props,
    }),
  );

describe("StartCount", () => {
  it("offers a primary 'Conteggio giornaliero' and a secondary 'Conteggio mensile'", () => {
    const html = render();
    expect(html).toMatch(/bg-accent[^>]*>Conteggio giornaliero</);
    expect(html).toMatch(/border-ink[^>]*>Conteggio mensile</);
  });

  it("has no location field with one location, and a labelled one with two", () => {
    expect(render()).not.toContain("Ubicazione");
    const html = render({
      locations: [
        { id: CELLA, name: "Cella (demo)" },
        { id: FREEZER, name: "Freezer (demo)" },
      ],
    });
    expect(html).toContain("Ubicazione");
    expect(html).toContain("Freezer (demo)");
  });

  it("shows an open count as a card with its progress and 'Riprendi', and no start buttons", () => {
    const html = render({ openSession: OPEN });
    expect(html).toContain("Conteggio in corso");
    expect(html).toContain("Giornaliero · Cella (demo) · 12 di 20 contati");
    expect(html).toMatch(new RegExp(`href="/magazzino/conteggi/${SESSION_ID}"[^>]*>Riprendi<`));
    expect(html).not.toContain("Conteggio giornaliero<");
    expect(html).not.toContain("Conteggio mensile");
  });

  it("disables the buttons while busy", () => {
    expect(render({ busy: true })).toMatch(/disabled=""[^>]*>Conteggio giornaliero</);
  });

  it("shows an error as an alert", () => {
    const html = render({ error: "C'è già un conteggio in corso in questa ubicazione." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("C&#x27;è già un conteggio");
  });
});
