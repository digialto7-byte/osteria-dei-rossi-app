import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PushRow } from "@/app/(owner)/spingere/push-row";
import type { PushListRow } from "@/server/push/output";
import { PUSH_LIST_CHEF, PUSH_LIST_OWNER } from "../helpers/push-data";

const noop = () => {};
const render = (row: PushListRow, role: "owner" | "admin" | "chef") =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(PushRow, { row, role, busy: false, onPush: noop, onStop: noop }),
    ),
  );
const plain = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");

const OWNER_B1 = PUSH_LIST_OWNER.rows[1]! as PushListRow;
const CHEF_B1 = PUSH_LIST_CHEF.rows[1]! as PushListRow;

describe("PushRow", () => {
  it("carries the row id, the sentence and the hours badge", () => {
    const markup = render(OWNER_B1, "owner");
    expect(markup).toContain(`data-push-row-id="${OWNER_B1.id}"`);
    expect(plain(markup)).toContain("38,00 € a rischio");
    expect(plain(markup)).toContain("tra 10 h");
  });

  it("the owner and the admin get 'Spingi oggi' on a plate that is not pushed", () => {
    for (const role of ["owner", "admin"] as const) {
      const markup = render(OWNER_B1, role);
      expect(markup).toContain(">Spingi oggi<");
      expect(markup).not.toContain(">Togli<");
    }
  });

  it("a pushed plate shows the end and the price, with 'Togli' instead", () => {
    const row = {
      ...OWNER_B1,
      plates: OWNER_B1.plates.map((p) => ({
        ...p,
        pushed: true,
        pushUntil: "2026-11-05T01:00:00Z",
        pushPrice: 12 as number | null,
      })),
    } as PushListRow;
    const markup = render(row, "owner");
    expect(plain(markup)).toContain("In evidenza fino alle 02:00 · 12,00 €");
    expect(markup).toContain(">Togli<");
    expect(markup).not.toContain(">Spingi oggi<");
  });

  it("a pushed plate without a price shows no amount", () => {
    const row = {
      ...OWNER_B1,
      plates: OWNER_B1.plates.map((p) => ({
        ...p,
        pushed: true,
        pushUntil: "2026-11-05T01:00:00Z",
        pushPrice: null,
      })),
    } as PushListRow;
    expect(plain(render(row, "owner"))).toMatch(/In evidenza fino alle 02:00(?! ·)/);
  });

  it("the chef sees no button, no euro and the hint", () => {
    const markup = render(CHEF_B1, "chef");
    expect(markup).not.toContain("<button");
    expect(plain(markup)).not.toContain("€");
    expect(plain(markup)).toContain("Chiedi al titolare di metterlo in evidenza");
  });

  it("a row without a plate has no hint and no button", () => {
    const lot = PUSH_LIST_CHEF.rows[2]! as PushListRow;
    const markup = render(lot, "chef");
    expect(markup).not.toContain("Chiedi al titolare");
    expect(markup).not.toContain("<button");
  });

  it("every button is a tap target of 44 px", () => {
    const buttons = [...render(OWNER_B1, "owner").matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toContain("min-h-tap");
  });
});
