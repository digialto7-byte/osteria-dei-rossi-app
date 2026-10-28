import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PinPad } from "@/app/(public)/pin/pin-pad";

const render = (over: Partial<Parameters<typeof PinPad>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PinPad, {
      name: "Cameriere Demo",
      pin: "",
      busy: false,
      message: null,
      onChange: () => undefined,
      onSubmit: () => undefined,
      onBack: () => undefined,
      ...over,
    }),
  );

describe("PinPad", () => {
  it("the PIN input is a masked numeric field with a visible label", () => {
    const html = render();
    const input = /<input[^>]*>/.exec(html)![0];
    expect(input).toContain('type="password"');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('autoComplete="off"');
    expect(input).toContain('maxLength="4"');
    expect(input).toContain('pattern="[0-9]{4}"');
    expect(html).toMatch(/<span[^>]*>PIN<\/span>/);
  });
  it("greets the person by name and has one primary and one secondary button", () => {
    const html = render();
    expect(html).toContain("Ciao, Cameriere Demo");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Entra<\/button>/);
    expect(html).toMatch(/>Cambia persona<\/button>/);
    expect(html.match(/bg-accent /g)).toHaveLength(1);
  });
  it("the submit button waits for four digits and while busy", () => {
    expect(render({ pin: "48" })).toMatch(/<button[^>]*disabled=""[^>]*>Entra/);
    expect(render({ pin: "4827" })).not.toMatch(/<button[^>]*disabled=""[^>]*>Entra/);
    expect(render({ pin: "4827", busy: true })).toMatch(/<button[^>]*disabled=""[^>]*>Entra/);
  });
  it("shows a message as an alert", () => {
    expect(render({ message: "PIN errato. Tentativi rimasti: 2." })).toMatch(
      /role="alert"[^>]*>PIN errato\. Tentativi rimasti: 2\./,
    );
    expect(render()).not.toContain('role="alert"');
  });
  it("escapes the name", () => {
    expect(render({ name: "<b>x</b>" })).not.toContain("<b>x</b>");
  });
});
