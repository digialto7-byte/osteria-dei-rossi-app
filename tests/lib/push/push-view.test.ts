import { describe, expect, it } from "vitest";
import {
  forecastLine,
  hoursBadge,
  pushLine,
  pushedPlateText,
  shortfallBadge,
} from "@/lib/push/push-view";
import type { PushListRow } from "@/server/push/output";
import { PUSH_LIST_CHEF, PUSH_LIST_OWNER } from "../../helpers/push-data";

const plain = (text: string) => text.replace(/ /g, " ");
const owner = (id: string) => PUSH_LIST_OWNER.rows.find((r) => r.id === id)! as PushListRow;
const chef = (id: string) => PUSH_LIST_CHEF.rows.find((r) => r.id === id)! as PushListRow;
const B1 = "ba000000-0000-4000-8000-000000000001";
const B2 = "ba000000-0000-4000-8000-000000000002";
const L1 = "1e000000-0000-4000-8000-000000000001";

describe("pushLine (AT2: the PRD sentence)", () => {
  it("a batch, owner, Italian", () => {
    expect(plain(pushLine(owner(B1), "owner", "it"))).toBe(
      "Spezzatino, prodotto lun, da consumare entro mer 20:00, 14 porzioni, 38,00 € a rischio → spingi Spezzatino con polenta",
    );
  });

  it("the same in English", () => {
    expect(plain(pushLine(owner(B1), "owner", "en"))).toBe(
      "Spezzatino, made Mon, use by Wed 20:00, 14 portions, €38.00 at risk → push Spezzatino con polenta",
    );
  });

  it("the admin reads the same as the owner", () => {
    expect(pushLine(owner(B1), "admin", "it")).toBe(pushLine(owner(B1), "owner", "it"));
  });

  it("the chef's sentence has no euro and no 'a rischio'", () => {
    const line = plain(pushLine(chef(B1), "chef", "it"));
    expect(line).toBe(
      "Spezzatino, prodotto lun, da consumare entro mer 20:00, 14 porzioni → spingi Spezzatino con polenta",
    );
    expect(line).not.toContain("€");
    expect(line).not.toContain("a rischio");
  });

  it("an unknown cost says so instead of an amount", () => {
    const line = plain(pushLine(owner(B2), "owner", "it"));
    expect(line).toContain("costo non noto");
    expect(line).not.toContain("a rischio");
    expect(line).not.toContain("0,00");
  });

  it("a lot reaching plates through a batch recipe (the L1 row)", () => {
    expect(plain(pushLine(owner(L1), "owner", "it"))).toBe(
      "Manzo (demo), arrivato lun, scade gio, 3,2 kg, 38,40 € a rischio → usato in Spezzatino",
    );
  });

  it("a single portion is singular", () => {
    expect(plain(pushLine({ ...owner(B1), quantity: 1 }, "owner", "it"))).toContain(
      ", 1 porzione,",
    );
  });

  it("a row nobody uses has no arrow", () => {
    const row = { ...owner(B1), plates: [], batchRecipes: [] } as PushListRow;
    expect(plain(pushLine(row, "owner", "it"))).not.toContain("→");
  });

  it("plates and batch recipes together are both named", () => {
    const row = {
      ...owner(L1),
      plates: owner(B1).plates,
    } as PushListRow;
    const line = plain(pushLine(row, "owner", "it"));
    expect(line).toContain("spingi Spezzatino con polenta");
    expect(line).toContain("usato in Spezzatino");
  });
});

describe("pushedPlateText", () => {
  it("marks a pushed plate with the star", () => {
    expect(pushedPlateText(true, "it")).toBe("★ in evidenza");
    expect(pushedPlateText(true, "en")).toBe("★ featured");
    expect(pushedPlateText(false, "it")).toBeNull();
  });
});

describe("hoursBadge", () => {
  it.each([
    [0.5, "it", "tra 30 min"],
    [0, "it", "tra 0 min"],
    [0.99, "it", "tra 59 min"],
    [4, "it", "tra 4 h"],
    [10.5, "it", "tra 10,5 h"],
    [38, "en", "in 38 h"],
    [0.5, "en", "in 30 min"],
  ] as const)("%s h (%s) is %s", (hours, locale, text) => {
    expect(hoursBadge(hours, locale)).toBe(text);
  });
});

describe("forecastLine (AT5: the sentence)", () => {
  const base = {
    date: "2026-11-05",
    name: "Spezzatino",
    expected: 22 as number | null,
    onHand: 14,
  };

  it("Italian", () => {
    expect(forecastLine(base, "it")).toBe(
      "Di solito il giovedì escono 22 porzioni di Spezzatino; ne hai 14",
    );
  });

  it("English", () => {
    expect(forecastLine({ ...base, name: "stew" }, "en")).toBe(
      "Thu usually sells 22 stew, you have 14",
    );
    expect(forecastLine({ ...base, name: "stew" }, "it")).toBe(
      "Di solito il giovedì escono 22 porzioni di stew; ne hai 14",
    );
  });

  it("an average with decimals shows one", () => {
    expect(forecastLine({ ...base, expected: 22.33 }, "it")).toContain("escono 22,3 porzioni");
  });

  it("exactly one is singular", () => {
    expect(forecastLine({ ...base, expected: 1 }, "it")).toBe(
      "Di solito il giovedì esce 1 porzione di Spezzatino; ne hai 14",
    );
  });

  it("no history gives the empty text", () => {
    expect(forecastLine({ ...base, expected: null }, "it")).toBe(
      "Non ci sono ancora vendite di questo giorno.",
    );
  });

  it("refuses a date that is not real", () => {
    expect(() => forecastLine({ ...base, date: "2026-02-30" }, "it")).toThrow(RangeError);
  });
});

describe("shortfallBadge", () => {
  it.each([
    [8, "ne mancano 8"],
    [1, "ne manca 1"],
    [1.25, "ne mancano 1,3"],
  ])("a gap of %s is '%s'", (gap, text) => {
    expect(shortfallBadge(gap, "it")).toBe(text);
  });

  it("no badge for a gap that is not positive, or unknown", () => {
    expect(shortfallBadge(0, "it")).toBeNull();
    expect(shortfallBadge(-3, "it")).toBeNull();
    expect(shortfallBadge(null, "it")).toBeNull();
  });
});
