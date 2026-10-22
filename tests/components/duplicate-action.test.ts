import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DuplicateAction,
  DuplicateActionView,
} from "@/app/(owner)/fatture/[id]/revisione/duplicate-action";
import { duplicateGuidance } from "@/lib/invoices/duplicate-view";
import { makeReview } from "../helpers/review-line";

const PARTNER = {
  id: "1b000000-0000-4000-8000-0000000000b2",
  number: "FT 40",
  date: "2026-09-01",
};
const guidance = duplicateGuidance("review", PARTNER);
const view = (busy: boolean, error: string | null = null, g = guidance) =>
  renderToStaticMarkup(
    createElement(DuplicateActionView, { guidance: g, busy, error, onClear: () => {} }),
  );

describe("DuplicateActionView", () => {
  it("names the look-alike on the button", () => {
    expect(view(false)).toMatch(
      /<button[^>]*>Non è un doppione di FT 40 del 01\/09\/2026<\/button>/,
    );
  });

  it("enables the button at rest and disables it while the request is on its way", () => {
    expect(view(false)).not.toContain('disabled=""');
    expect(view(true)).toMatch(/<button[^>]*disabled=""[^>]*>Non è un doppione di/);
    expect(view(true)).toMatch(/aria-busy="true"/);
  });

  it("shows the refusal next to the button", () => {
    expect(view(false, "Il doppione indicato non è più valido")).toContain(
      "Il doppione indicato non è più valido",
    );
  });

  it("shows the hint, and no button, for a duplicate whose original has left", () => {
    const html = view(false, null, duplicateGuidance("duplicate", null));
    expect(html).toContain("Non c&#x27;è più un originale attivo");
    expect(html).not.toMatch(/<button/);
  });

  it("draws nothing when there is nothing to declare", () => {
    expect(view(false, null, duplicateGuidance("review", null))).toBe("");
  });
});

describe("DuplicateAction", () => {
  const render = (partner: typeof PARTNER | null, status: "review" | "duplicate" = "review") =>
    renderToStaticMarkup(
      createElement(DuplicateAction, {
        invoice: { ...makeReview().invoice, status },
        partner,
        clear: async () => null,
      }),
    );

  it("starts enabled and names the partner of the review", () => {
    const html = render(PARTNER);
    expect(html).toContain("Non è un doppione di FT 40 del 01/09/2026");
    expect(html).not.toContain('disabled=""');
  });

  it("offers nothing without a partner on an invoice in review", () => {
    expect(render(null)).toBe("");
  });
});
