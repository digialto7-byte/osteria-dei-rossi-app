import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaffForm } from "@/app/(owner)/personale/staff-form";

const html = renderToStaticMarkup(createElement(StaffForm, { onAdded: () => undefined }));

describe("StaffForm (add a person)", () => {
  it("has the name field with its hint, a role select and one primary button", () => {
    expect(html).toContain("Solo il nome con cui ti riconoscono in sala o in cucina");
    expect(html).toMatch(/<select[^>]*name="role"[^>]*>/);
    expect(html).toMatch(/<option[^>]*value="waiter"[^>]*>Cameriere<\/option>/);
    expect(html).toMatch(/<option[^>]*value="chef"[^>]*>Cuoco<\/option>/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Aggiungi<\/button>/);
  });
  it("uses a select, not radios, so every control is a 44 px tap target", () => {
    expect(html).not.toContain('type="radio"');
  });
  it("asks for the PIN twice on masked numeric fields", () => {
    const inputs = html.match(/<input[^>]*type="password"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain('inputMode="numeric"');
      expect(input).toContain('autoComplete="off"');
      expect(input).toContain('maxLength="4"');
    }
    expect(html).toContain("PIN (4 cifre)");
    expect(html).toContain("Ripeti PIN");
  });
});
