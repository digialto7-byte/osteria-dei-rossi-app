import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnrolForm } from "@/app/(public)/dispositivo/enrol-form";

const html = renderToStaticMarkup(createElement(EnrolForm, { initialState: "idle" }));

describe("EnrolForm", () => {
  it("has a labelled code field that capitalises, with the hint", () => {
    expect(html).toMatch(/<span[^>]*>Codice di abilitazione<\/span>/);
    const input = /<input[^>]*>/.exec(html)![0];
    expect(input).toContain('autoCapitalize="characters"');
    expect(input).toContain('autoComplete="off"');
    expect(html).toContain("Lo trovi sul telefono del titolare, vale 15 minuti.");
  });
  it("one primary button", () => {
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Abilita<\/button>/);
  });
  it("explains the installed-app case (Q12)", () => {
    expect(html).toContain("Se usi l&#x27;app installata sulla schermata Home, abilitala da lì.");
  });
  it("after success it names the device and links to the PIN screen", () => {
    const done = renderToStaticMarkup(
      createElement(EnrolForm, { initialState: "done", label: "Telefono sala (demo)" }),
    );
    expect(done).toContain("Dispositivo abilitato: Telefono sala (demo).");
    expect(done).toMatch(/<a[^>]*href="\/pin"[^>]*>Vai all&#x27;accesso con PIN<\/a>/);
    expect(done).not.toContain("<input");
  });
});
