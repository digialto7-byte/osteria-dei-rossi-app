import { describe, expect, it } from "vitest";
import {
  addBody,
  canDecrease,
  canIncrease,
  clientStamp,
  halfPressed,
  nextQty,
  parseWeightText,
  weightAllowed,
  weightNeedsConfirm,
  patchFor,
  removeBody,
  toggleHalf,
} from "@/lib/orders/line-form";
import { addLineBody, removeLineBody, updateLineBody } from "@/server/orders/schemas";
import { LINE_SOUP, LINE_STEAK, LINE_STEW, OIDS } from "../../helpers/orders-data";

const NOW = new Date("2026-11-02T19:40:00.500Z");

describe("nextQty (whole portions, never below 1)", () => {
  it("steps by one portion", () => {
    expect(nextQty(1, 1)).toBe(2);
    expect(nextQty(2, -1)).toBe(1);
    expect(nextQty(4, 1)).toBe(5);
  });

  it("never reaches 0", () => {
    expect(nextQty(1, -1)).toBe(1);
    expect(nextQty(0.5, -1)).toBe(1);
  });

  it("leaves a half portion for a whole one", () => {
    expect(nextQty(0.5, 1)).toBe(1);
  });

  it("rounds a 1.5 to the next whole portion in either direction", () => {
    expect(nextQty(1.5, 1)).toBe(2);
    expect(nextQty(1.5, -1)).toBe(1);
  });

  it("stops at 99", () => {
    expect(nextQty(99, 1)).toBe(99);
    expect(nextQty(98, 1)).toBe(99);
  });
});

describe("the half portion toggle", () => {
  it("switches between 0.5 and a whole portion", () => {
    expect(toggleHalf(1)).toBe(0.5);
    expect(toggleHalf(3)).toBe(0.5);
    expect(toggleHalf(0.5)).toBe(1);
  });

  it("is pressed only at 0.5", () => {
    expect(halfPressed(0.5)).toBe(true);
    expect(halfPressed(1)).toBe(false);
    expect(halfPressed(1.5)).toBe(false);
  });
});

describe("clientStamp", () => {
  it("is the phone's clock with an offset", () => {
    expect(clientStamp(NOW)).toBe("2026-11-02T19:40:00.500Z");
  });

  it("never goes back before the line it edits (a slow clock must not lose to its own earlier write)", () => {
    const line = { clientUpdatedAt: "2026-11-02T19:41:00.000+00:00" };
    expect(clientStamp(NOW, line)).toBe("2026-11-02T19:41:00.001Z");
  });

  it("uses now when the line is older", () => {
    const line = { clientUpdatedAt: "2026-11-02T19:30:00.123+00:00" };
    expect(clientStamp(NOW, line)).toBe("2026-11-02T19:40:00.500Z");
  });

  it("copes with the microsecond text the database writes", () => {
    const line = { clientUpdatedAt: "2026-11-02T19:41:00.123456+00:00" };
    expect(clientStamp(NOW, line)).toBe("2026-11-02T19:41:00.124Z");
  });
});

describe("addBody", () => {
  it("builds the body of a tap: id, dish, the tab's course and the stamp", () => {
    const body = addBody({ lineId: OIDS.line3, menuItemId: OIDS.item, course: "secondi" }, NOW);
    expect(body).toEqual({
      lineId: OIDS.line3,
      menuItemId: OIDS.item,
      course: "secondi",
      clientUpdatedAt: "2026-11-02T19:40:00.500Z",
    });
    expect(addLineBody.safeParse(body).success).toBe(true);
  });
});

describe("patchFor", () => {
  it("sends only what changed, plus the stamp", () => {
    const patch = patchFor(LINE_STEW, { qty: 3, course: "secondi", segue: false }, NOW);
    expect(patch).toEqual({ qty: 3, clientUpdatedAt: "2026-11-02T19:40:00.500Z" });
    expect(updateLineBody.safeParse(patch).success).toBe(true);
  });

  it("is null when nothing changed", () => {
    expect(patchFor(LINE_STEW, { qty: 2, course: "secondi" }, NOW)).toBeNull();
    expect(patchFor(LINE_STEW, {}, NOW)).toBeNull();
  });

  it("moves a line by sending the course", () => {
    expect(patchFor(LINE_STEW, { course: "dolci" }, NOW)).toMatchObject({ course: "dolci" });
  });

  it("compares a note as the database stores it (trimmed; blank is null)", () => {
    expect(patchFor(LINE_SOUP, { note: "  senza cipolla  " }, NOW)).toBeNull();
    expect(patchFor(LINE_STEW, { note: "   " }, NOW)).toBeNull();
    expect(patchFor(LINE_STEW, { note: " ben cotto " }, NOW)).toMatchObject({ note: "ben cotto" });
    expect(patchFor(LINE_SOUP, { note: "" }, NOW)).toMatchObject({ note: null });
  });

  it("sends the flags that changed", () => {
    expect(patchFor(LINE_STEW, { segue: true, isShared: true }, NOW)).toMatchObject({
      segue: true,
      isShared: true,
    });
  });

  it("uses a stamp after the line's own", () => {
    const line = { ...LINE_STEW, clientUpdatedAt: "2026-11-02T19:50:00.000+00:00" };
    expect(patchFor(line, { qty: 5 }, NOW)).toMatchObject({
      clientUpdatedAt: "2026-11-02T19:50:00.001Z",
    });
  });
});

describe("removeBody", () => {
  it("is the stamp alone", () => {
    const body = removeBody(LINE_STEW, NOW);
    expect(body).toEqual({ clientUpdatedAt: "2026-11-02T19:40:00.500Z" });
    expect(removeLineBody.safeParse(body).success).toBe(true);
  });
});

describe("the stepper limits", () => {
  it("'−' is available above one portion, '+' below 99", () => {
    expect(canDecrease(1)).toBe(false);
    expect(canDecrease(0.5)).toBe(false);
    expect(canDecrease(1.5)).toBe(true);
    expect(canDecrease(2)).toBe(true);
    expect(canIncrease(98)).toBe(true);
    expect(canIncrease(99)).toBe(false);
    expect(canIncrease(0.5)).toBe(true);
  });
});

describe("the weight entry (P2-0b)", () => {
  it("parseWeightText reads whole grams only", () => {
    expect(parseWeightText("1200")).toBe(1200);
    expect(parseWeightText(" 250 ")).toBe(250);
    for (const bad of ["", "  ", "12,5", "1.200", "-50", "abc", "1e3", "0"]) {
      expect(parseWeightText(bad), bad).toBeNull();
    }
  });

  it("weightAllowed: 50 g minimum, steps of 10, the menu's maximum", () => {
    for (const ok of [50, 60, 1200, 3000]) expect(weightAllowed(ok, 3000), String(ok)).toBe(true);
    for (const bad of [0, 40, 49, 55, 1205, 3010]) {
      expect(weightAllowed(bad, 3000), String(bad)).toBe(false);
    }
    expect(weightAllowed(3500, 4000)).toBe(true);
    expect(weightAllowed(4010, 4000)).toBe(false);
    expect(weightAllowed(3500, 3000)).toBe(false);
  });

  it("weightNeedsConfirm: from 3 times the reference portion", () => {
    expect(weightNeedsConfirm(1200, 400)).toBe(true);
    expect(weightNeedsConfirm(1190, 400)).toBe(false);
    expect(weightNeedsConfirm(1500, 200)).toBe(true);
    expect(weightNeedsConfirm(5000, null)).toBe(false);
  });

  it("the add body of a weighted dish carries weightG and no qty", () => {
    const body = addBody(
      { lineId: OIDS.line3, menuItemId: OIDS.item3, course: "secondi", weightG: 1200 },
      NOW,
    );
    expect(body).toEqual({
      lineId: OIDS.line3,
      menuItemId: OIDS.item3,
      course: "secondi",
      weightG: 1200,
      clientUpdatedAt: "2026-11-02T19:40:00.500Z",
    });
    expect("qty" in body).toBe(false);
    expect(addLineBody.safeParse(body).success).toBe(true);
  });

  it("patchFor sends a changed weight as weightG and nothing else, and nothing for the same weight", () => {
    const patch = patchFor(LINE_STEAK, { weightG: 1300 }, NOW);
    expect(patch).toEqual({ weightG: 1300, clientUpdatedAt: "2026-11-02T19:40:00.500Z" });
    expect(updateLineBody.safeParse(patch).success).toBe(true);
    expect(patchFor(LINE_STEAK, { weightG: 1230 }, NOW)).toBeNull();
  });
});
