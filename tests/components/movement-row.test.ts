import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MovementRow } from "@/app/(owner)/produzione/[id]/movement-row";
import { BATCH_DETAIL } from "./batch-fixtures";

const render = (index: number, over: object = {}, locale?: "it" | "en") =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(MovementRow, {
        movement: { ...BATCH_DETAIL.movements[index]!, ...over },
        ...(locale ? { locale } : {}),
      }),
    ),
  );

describe("MovementRow", () => {
  it("words a discard with its reason, the portions, the initials and the Rome time", () => {
    expect(render(1)).toMatch(
      /<p class="num[^"]*">Scarto · Deteriorato · −3 porzioni · TD · 24\/10\/2026 11:00<\/p>/,
    );
  });

  it("words a split out, a count, a staff meal and a split in", () => {
    expect(render(0)).toContain("Divisione · −4 porzioni · CD · 24/10/2026 12:10");
    expect(render(0, { type: "count", portions: -1, refType: "batch_adjust" })).toContain(
      "Conteggio · −1 porzione · CD",
    );
    expect(render(1, { portions: -2, reasonCode: "staff_meal", refType: "staff_meal" })).toContain(
      "Pasto personale · −2 porzioni",
    );
    expect(render(0, { portions: 4 })).toContain("Divisione · +4 porzioni");
  });

  it("has English words", () => {
    expect(render(1, {}, "en")).toContain("Discard · Spoilage · −3 portions · TD");
  });

  it("escapes markup in the initials", () => {
    const html = render(1, { byInitials: "<script>x</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows no euro sign and no cost", () => {
    expect(render(1)).not.toContain("€");
  });
});
