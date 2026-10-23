import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaffRow } from "@/app/(owner)/personale/staff-row";
import type { StaffItem } from "@/lib/staff-auth/staff-view";

const ITEM: StaffItem = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Cameriere Demo",
  role: "waiter",
  loginMethod: "pin",
  active: true,
  lockedUntil: null,
};
const noop = () => undefined;
const render = (over: Partial<StaffItem> = {}, busy = false) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(StaffRow, {
        item: { ...ITEM, ...over },
        busy,
        onPin: noop,
        onToggle: noop,
        onRole: noop,
      }),
    ),
  );

describe("StaffRow", () => {
  it("shows the bold name and the role badge", () => {
    const html = render();
    expect(html).toMatch(
      /<span[^>]*font-bold[^>]*id="staff-1111[^"]*-name"[^>]*>Cameriere Demo<\/span>|<span[^>]*id="staff-[^"]*-name"[^>]*font-bold[^>]*>Cameriere Demo<\/span>/,
    );
    expect(html).toContain("Cameriere</span>");
  });
  it("the three actions are 44 px buttons described by the name", () => {
    const html = render();
    const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toContain("min-h-tap");
      expect(button).toMatch(/aria-describedby="staff-[^"]*-name"/);
    }
    for (const word of ["Cambia PIN", "Disattiva", "Cambia ruolo"])
      expect(html).toContain(`>${word}<`);
  });
  it("a locked person shows 'Bloccato fino alle 21:15'", () => {
    expect(render({ lockedUntil: "2026-10-24T19:15:00Z" })).toContain("Bloccato fino alle 21:15");
  });
  it("an inactive person shows 'Disattivato', 'Riattiva' and no PIN action", () => {
    const html = render({ active: false });
    expect(html).toContain("Disattivato");
    expect(html).toContain(">Riattiva<");
    expect(html).not.toContain("Cambia PIN");
  });
  it("an email account shows 'Accesso con email' and no PIN action", () => {
    const html = render({ loginMethod: "email" });
    expect(html).toContain("Accesso con email");
    expect(html).not.toContain("Cambia PIN");
  });
  it("renders no login time of the person", () => {
    for (const html of [
      render(),
      render({ lockedUntil: "2026-10-24T19:15:00Z" }),
      render({ active: false }),
    ]) {
      expect(html).not.toMatch(/ultimo accesso|last login|ultimo ingresso/i);
    }
  });
  it("buttons are disabled while busy; the name is escaped", () => {
    expect(render({}, true).match(/disabled=""/g)).toHaveLength(3);
    const html = render({ displayName: "<script>x</script>" });
    expect(html).not.toContain("<script>");
  });
});
