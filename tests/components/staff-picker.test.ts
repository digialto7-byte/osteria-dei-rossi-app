import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaffPicker } from "@/app/pin/staff-picker";

const STAFF = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Cameriere Demo",
    role: "waiter" as const,
  },
  { id: "22222222-2222-4222-8222-222222222222", displayName: "Cuoco Demo", role: "chef" as const },
];
const render = (staff = STAFF) =>
  renderToStaticMarkup(createElement(StaffPicker, { staff, onPick: () => undefined }));

describe("StaffPicker", () => {
  it("one button per person with the name and the role word", () => {
    const html = render();
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("Cameriere Demo");
    expect(html).toContain("Cuoco Demo");
    expect(html).toMatch(/>Cameriere</);
    expect(html).toMatch(/>Cuoco</);
  });
  it("the buttons are 44 px tap targets", () => {
    expect(render()).toMatch(/<button[^>]*min-h-tap/);
  });
  it("escapes a name that contains markup", () => {
    const html = render([{ ...STAFF[0]!, displayName: "<script>alert(1)</script>" }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("an empty list says so instead of showing nothing", () => {
    expect(render([])).toContain("Nessuna persona abilitata su questo dispositivo.");
  });
});
