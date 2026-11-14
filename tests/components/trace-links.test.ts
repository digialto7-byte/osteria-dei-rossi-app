import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LotRow } from "@/app/(owner)/magazzino/[ingredientId]/lot-row";
import { BatchFacts } from "@/app/(owner)/produzione/[id]/batch-facts";
import { BATCH_DETAIL, BATCH_ID } from "./batch-fixtures";
import { LOT, LOT_ID } from "./stock-fixtures";

// P2-2 spec §5: a batch links to its trace under the fact card, a stock lot row to its lot page; neither for a role without the trace.
const batch = (props: object = {}) =>
  renderToStaticMarkup(createElement(BatchFacts, { detail: BATCH_DETAIL, ...props }));
const lot = (props: object = {}, over: object = {}) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(LotRow, { lot: { ...LOT, ...over }, unit: "kg", ...props }),
    ),
  );

describe("the trace link on a batch", () => {
  it("shows 'Tracciabilità' to the trace roles, after the fact card, as a link of 44 px", () => {
    const html = batch({ showTrace: true });
    expect(html).toMatch(
      new RegExp(
        `</dl>[\\s\\S]*</div><a[^>]*min-h-tap[^>]*href="/tracciabilita/produzione/${BATCH_ID}"[^>]*>Tracciabilità[\\s\\S]*›</a>`,
      ),
    );
  });

  it("is absent without the flag, and in English it is 'Traceability'", () => {
    expect(batch()).not.toContain("/tracciabilita/");
    expect(batch({ showTrace: true, locale: "en" })).toContain("Traceability");
  });
});

describe("the trace link on a stock lot row", () => {
  it("shows 'Traccia' to the trace roles, linking the lot page", () => {
    const html = lot({ showTrace: true });
    expect(html).toMatch(
      new RegExp(
        `<a[^>]*min-h-tap[^>]*href="/tracciabilita/lotto/${LOT_ID}"[^>]*>Traccia[\\s\\S]*›</a>`,
      ),
    );
  });

  it("is absent without the flag, and never on the 'Senza lotto' bucket", () => {
    expect(lot()).not.toContain("/tracciabilita/");
    expect(lot({ showTrace: true }, { rawLotId: null, lotCode: null })).not.toContain(
      "/tracciabilita/",
    );
  });
});
