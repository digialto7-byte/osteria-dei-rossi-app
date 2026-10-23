import { describe, expect, it } from "vitest";
import {
  canReadStock,
  canReadWasteCosts,
  expiryView,
  formatSignedQty,
  movementTypeWord,
} from "@/lib/stock/stock-view";

describe("expiryView", () => {
  it("expired is a danger badge with the date", () => {
    expect(expiryView("expired", "2026-10-21")).toEqual({
      tone: "danger",
      label: "Scaduto il 21/10/2026",
    });
  });
  it("due_soon is a warning", () => {
    expect(expiryView("due_soon", "2026-10-24")).toEqual({
      tone: "warning",
      label: "Scade il 24/10/2026",
    });
  });
  it("ok is neutral", () => {
    expect(expiryView("ok", "2026-10-28")).toEqual({
      tone: "neutral",
      label: "Scade il 28/10/2026",
    });
  });
  it("none says there is no expiry and shows no date", () => {
    expect(expiryView("none", null)).toEqual({ tone: "neutral", label: "Senza scadenza" });
  });
  it("shows a calendar date as written, also on the DST change day (no time zone shift)", () => {
    expect(expiryView("ok", "2026-10-25").label).toBe("Scade il 25/10/2026");
    expect(expiryView("expired", "2026-10-25", "en").label).toBe("Expired on 25/10/2026");
  });
});

describe("movementTypeWord", () => {
  it("words the five types", () => {
    expect(movementTypeWord("receipt", false)).toBe("Carico da fattura");
    expect(movementTypeWord("consumption", false)).toBe("Consumo");
    expect(movementTypeWord("waste", false)).toBe("Spreco");
    expect(movementTypeWord("transfer", false)).toBe("Spostamento");
    expect(movementTypeWord("count", false)).toBe("Conteggio");
  });
  it("a reversal is an Annullamento, whatever its type", () => {
    for (const type of ["waste", "consumption", "transfer"] as const) {
      expect(movementTypeWord(type, true)).toBe("Annullamento");
    }
    expect(movementTypeWord("waste", true, "en")).toBe("Reversal");
  });
});

describe("formatSignedQty", () => {
  it("writes a negative quantity with the real minus sign (U+2212)", () => {
    expect(formatSignedQty(-1.5, "kg")).toBe("−1,5 kg");
    expect(formatSignedQty(-1, "pz")).toBe("−1 pz");
  });
  it("writes a positive one with a plus and zero plain", () => {
    expect(formatSignedQty(1.5, "kg")).toBe("+1,5 kg");
    expect(formatSignedQty(0, "kg")).toBe("0 kg");
  });
  it("English decimals", () => {
    expect(formatSignedQty(-1.5, "l", "en")).toBe("−1.5 l");
  });
});

describe("role helpers (mirror the API role lists)", () => {
  it("canReadStock: owner, admin and chef", () => {
    expect(["owner", "admin", "chef"].map(canReadStock)).toEqual([true, true, true]);
    expect([canReadStock("waiter"), canReadStock("unknown"), canReadStock("")]).toEqual([
      false,
      false,
      false,
    ]);
  });
  it("canReadWasteCosts: owner and admin only", () => {
    expect(["owner", "admin"].map(canReadWasteCosts)).toEqual([true, true]);
    expect(["chef", "waiter", "unknown", ""].map(canReadWasteCosts)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
