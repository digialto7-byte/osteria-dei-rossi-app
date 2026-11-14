import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";

const TONES = {
  neutral: ["bg-sunk", "text-ink-muted"],
  info: ["bg-info-bg", "text-info"],
  warning: ["bg-warning-bg", "text-warning"],
  success: ["bg-success-bg", "text-success"],
  danger: ["bg-danger-bg", "text-danger"],
  highlight: ["bg-highlight", "text-on-highlight"],
} as const;

describe("Badge", () => {
  it.each(Object.entries(TONES))("%s renders its word with its token classes", (tone, classes) => {
    const html = renderToStaticMarkup(
      createElement(Badge, { tone: tone as keyof typeof TONES }, "Da abbinare"),
    );
    expect(html).toContain("Da abbinare");
    for (const name of classes) expect(html).toContain(name);
  });

  it("uses token classes only: no palette colour, hex value or inline style", () => {
    for (const tone of Object.keys(TONES)) {
      const html = renderToStaticMarkup(
        createElement(Badge, { tone: tone as keyof typeof TONES }, "x"),
      );
      expect(html).not.toMatch(
        /#[0-9a-f]{3,8}|style=|(?:bg|text|border)-(?:red|green|blue|yellow|gray|slate|amber)-\d/i,
      );
      expect(html).not.toMatch(/text-gold|text-highlight/);
    }
  });

  it("puts a decorative dot beside the word, so colour never stands alone", () => {
    const html = renderToStaticMarkup(createElement(Badge, { tone: "warning" }, "Corretta"));
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><\/span>Corretta/);
  });

  it("passes data attributes through (the status badge keeps its test id)", () => {
    const html = renderToStaticMarkup(
      createElement(
        Badge,
        { tone: "info", "data-testid": "invoice-status" } as never,
        "In lettura",
      ),
    );
    expect(html).toContain('data-testid="invoice-status"');
  });

  // The highlight tone replaces RecommendedBadge (docs/ux/costi-design-system.md §10.3): Coral fill with Charcoal text, the AA-tested pair.
  it("highlight is the yellow/Coral pair with its own dot, a data-tone and the words of the recommendation", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { tone: "highlight" }, t("menu.recommended")),
    );
    expect(html).toContain('data-tone="highlight"');
    expect(html).toMatch(/class="[^"]*bg-highlight text-on-highlight/);
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*bg-on-highlight[^"]*"><\/span>Consigliato/,
    );
  });
});
