import { describe, expect, it } from "vitest";
import {
  addBody,
  clientStamp,
  halfPressed,
  nextQty,
  patchFor,
  removeBody,
  toggleHalf,
} from "@/lib/orders/line-form";
import { addLineBody, removeLineBody, updateLineBody } from "@/server/orders/schemas";
import { LINE_SOUP, LINE_STEW, OIDS } from "../../helpers/orders-data";

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
