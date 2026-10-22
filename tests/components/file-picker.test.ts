import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecommendedBadge } from "@/components/brand";
import { Field, FilePicker } from "@/components/ui";

// Field's props type requires `children`; createElement passes them as its third argument.
const fieldProps = { label: "Carica PDF o foto", hint: "Fino a 4 MB" } as ComponentProps<
  typeof Field
>;

const render = (fileName: string | null, buttonLabel?: string) =>
  renderToStaticMarkup(
    createElement(
      Field,
      fieldProps,
      createElement(FilePicker, { fileName, buttonLabel, accept: "application/pdf" }),
    ),
  );

describe("FilePicker inside Field", () => {
  it("keeps the real input inside the one label, transparent over the drawn button", () => {
    const html = render(null);
    expect(html.match(/<label/g)).toHaveLength(1);
    expect(html).toMatch(/^<label[\s\S]*<input type="file"[^>]*>[\s\S]*<\/label>$/);
    const input = /<input[^>]*>/.exec(html)![0];
    expect(input).toContain('accept="application/pdf"');
    expect(input).toMatch(/class="[^"]*absolute inset-\[-1\.5px\][^"]*opacity-0/);
    // Not sr-only: the e2e phone check measures visible inputs at 44 px or more.
    expect(input).not.toContain("sr-only");
  });

  it("draws an Italian button and status that stay out of the label's text", () => {
    const html = render(null);
    expect(html).toContain('<span aria-hidden="true">Scegli file</span>');
    expect(html).toMatch(/aria-hidden="true"[^>]*>Nessun file scelto</);
    expect(html).not.toContain("Choose File");
  });

  it("describes the input with the status line", () => {
    const html = render(null);
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
  });

  it("keeps a caller's description next to the status line", () => {
    const html = renderToStaticMarkup(
      createElement(FilePicker, { fileName: null, "aria-describedby": "hint-id" }),
    );
    const ids = /aria-describedby="([^"]+)"/.exec(html)?.[1]?.split(" ") ?? [];
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("hint-id");
    expect(html).toContain(`id="${ids[1]}"`);
  });

  it("shows the chosen file name, and the camera wording when asked", () => {
    expect(render("fattura-demo.pdf")).toContain("File scelto: fattura-demo.pdf");
    expect(render(null, "Scatta foto")).toContain('<span aria-hidden="true">Scatta foto</span>');
  });

  it("draws the focus ring on the wrapper, since the input itself is transparent", () => {
    expect(render(null)).toContain("has-[:focus-visible]:outline-focus");
  });
});

describe("RecommendedBadge", () => {
  it("says it in words on the AA-tested yellow pair", () => {
    const html = renderToStaticMarkup(createElement(RecommendedBadge));
    expect(html).toContain("Consigliato dall&#x27;Oste");
    expect(html).toMatch(/bg-highlight[^"]*text-on-highlight/);
  });
});
