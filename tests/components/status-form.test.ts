import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusForm } from "@/app/(owner)/pagamenti/[id]/status-form";
import type { PayableStatus } from "@/server/payables/types";

const render = (allowed: PayableStatus[], busy = false) =>
  renderToStaticMarkup(
    createElement(StatusForm, { allowed, today: "2026-10-23", busy, onSubmit: () => {} }),
  );
const OPEN: PayableStatus[] = ["scheduled", "paid", "disputed"];

describe("StatusForm", () => {
  it("shows only the actions the server allows", () => {
    const html = render(OPEN);
    expect(html).toContain("Segna come pagata");
    expect(html).toContain("Segna come programmata");
    expect(html).toContain("Segna come contestata");
    expect(html).not.toContain("Riporta a da pagare");
    const scheduled = render(["open", "paid", "disputed"]);
    expect(scheduled).toContain("Riporta a da pagare");
    expect(scheduled).not.toContain("Segna come programmata");
  });

  it("renders nothing when no action is allowed (a paid payable)", () => {
    expect(render([])).toBe("");
  });

  it("'Segna come pagata' is the one primary button and submits the form", () => {
    const html = render(OPEN);
    expect(html.match(/<button[^>]*bg-accent[^>]*>/g)).toHaveLength(1);
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*bg-accent[^>]*>Segna come pagata<\/button>/,
    );
    expect(html).toMatch(/<button[^>]*border-ink[^>]*>Segna come programmata<\/button>/);
  });

  it("the payment date is a labelled date field that starts at the server's today", () => {
    const html = render(OPEN);
    expect(html).toMatch(
      /<label[^>]*>[\s\S]*Data del pagamento[\s\S]*<input[^>]*type="date"[^>]*value="2026-10-23"/,
    );
  });

  it("has no date field when paying is not an option", () => {
    expect(render(["open"])).not.toContain('type="date"');
  });

  it("the note is labelled and carries the no-personal-data hint, capped at 200", () => {
    const html = render(OPEN);
    expect(html).toMatch(/<label[^>]*>[\s\S]*Nota[\s\S]*<input[^>]*maxLength="200"/);
    expect(html).toContain("Non inserire dati personali.");
  });

  it("disables every button while the request is on its way", () => {
    expect(render(OPEN, true).match(/<button[^>]*disabled=""/g)).toHaveLength(3);
  });
});
