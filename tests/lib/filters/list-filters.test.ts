import { describe, expect, it } from "vitest";
import {
  hasActiveFilters,
  rangeInvalid,
  readListFilters,
  readPayableStato,
  toApiQuery,
  toPageHref,
} from "@/lib/filters/list-filters";

// M25b step 9 (plan §3.1.9): pure helpers for the "Dal / Al / Fornitore" filters kept in the page address. Italian page keys (dal, al,
// fornitore, stato), English API keys (from, to, supplier). An invalid value in the address is ignored, never sent.
const ID = "5a000000-0000-4000-8000-00000000005a";
const ID2 = "5c000000-0000-4000-8000-00000000005c";
const q = (s: string) => new URLSearchParams(s);

describe("readListFilters", () => {
  it("reads the three keys", () => {
    expect(readListFilters(q(`dal=2026-11-01&al=2026-11-30&fornitore=${ID}`))).toEqual({
      dal: "2026-11-01",
      al: "2026-11-30",
      fornitore: ID,
    });
  });

  it("returns nulls for an empty address", () => {
    expect(readListFilters(q(""))).toEqual({ dal: null, al: null, fornitore: null });
  });

  it("reads one side only", () => {
    expect(readListFilters(q("dal=2026-11-01"))).toEqual({
      dal: "2026-11-01",
      al: null,
      fornitore: null,
    });
    expect(readListFilters(q("al=2026-11-30"))).toMatchObject({ dal: null, al: "2026-11-30" });
  });

  it.each(["2026-11-31", "ieri", "2026-13-01", "01/11/2026", "2026-1-1", ""])(
    "ignores the invalid date %j",
    (value) => {
      expect(readListFilters(q(`dal=${encodeURIComponent(value)}`)).dal).toBeNull();
      expect(readListFilters(q(`al=${encodeURIComponent(value)}`)).al).toBeNull();
    },
  );

  it("ignores a supplier that is not a uuid", () => {
    expect(readListFilters(q("fornitore=abc")).fornitore).toBeNull();
    expect(readListFilters(q("fornitore=")).fornitore).toBeNull();
  });

  it("accepts a leap day and refuses a non-leap one", () => {
    expect(readListFilters(q("dal=2028-02-29")).dal).toBe("2028-02-29");
    expect(readListFilters(q("dal=2026-02-29")).dal).toBeNull();
  });
});

describe("toApiQuery", () => {
  it("renames the keys to the API's", () => {
    expect(toApiQuery({ dal: "2026-11-01", al: "2026-11-30", fornitore: ID })).toBe(
      `from=2026-11-01&to=2026-11-30&supplier=${ID}`,
    );
  });

  it("omits absent keys", () => {
    expect(toApiQuery({})).toBe("");
    expect(toApiQuery({ dal: null, al: null, fornitore: null })).toBe("");
    expect(toApiQuery({ al: "2026-11-30" })).toBe("to=2026-11-30");
    expect(toApiQuery({ fornitore: ID })).toBe(`supplier=${ID}`);
  });
});

describe("toPageHref", () => {
  it("is the bare path with no filter", () => {
    expect(toPageHref("/pagamenti", {})).toBe("/pagamenti");
    expect(toPageHref("/fatture", { dal: null, al: null, fornitore: null })).toBe("/fatture");
  });

  it("writes the filters in a fixed order, then the extras", () => {
    expect(toPageHref("/pagamenti", { fornitore: ID }, { stato: "pagate" })).toBe(
      `/pagamenti?fornitore=${ID}&stato=pagate`,
    );
    expect(toPageHref("/fatture", { fornitore: ID2, al: "2026-10-31", dal: "2026-10-01" })).toBe(
      `/fatture?dal=2026-10-01&al=2026-10-31&fornitore=${ID2}`,
    );
  });

  it("leaves out an extra that is null or empty", () => {
    expect(toPageHref("/pagamenti", { dal: "2026-11-01" }, { stato: null })).toBe(
      "/pagamenti?dal=2026-11-01",
    );
    expect(toPageHref("/pagamenti", {}, { stato: "tutte" })).toBe("/pagamenti?stato=tutte");
  });
});

describe("hasActiveFilters", () => {
  it("is false for nothing and true for each single key", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ dal: null, al: null, fornitore: null })).toBe(false);
    expect(hasActiveFilters({ dal: "2026-11-01" })).toBe(true);
    expect(hasActiveFilters({ al: "2026-11-01" })).toBe(true);
    expect(hasActiveFilters({ fornitore: ID })).toBe(true);
  });
});

describe("rangeInvalid", () => {
  it("is true only when the start is after the end", () => {
    expect(rangeInvalid({ dal: "2026-11-02", al: "2026-11-01" })).toBe(true);
    expect(rangeInvalid({ dal: "2026-11-01", al: "2026-11-01" })).toBe(false);
    expect(rangeInvalid({ dal: "2026-11-01", al: "2026-11-02" })).toBe(false);
    expect(rangeInvalid({ dal: "2026-11-01", al: null })).toBe(false);
    expect(rangeInvalid({ dal: null, al: "2026-11-01" })).toBe(false);
    expect(rangeInvalid({})).toBe(false);
  });
});

describe("readPayableStato", () => {
  it("maps the address word to the API filter", () => {
    expect(readPayableStato(q("stato=pagate"))).toBe("paid");
    expect(readPayableStato(q("stato=tutte"))).toBe("all");
  });

  it("defaults to unpaid for nothing or anything else", () => {
    expect(readPayableStato(q(""))).toBe("unpaid");
    expect(readPayableStato(q("stato=foo"))).toBe("unpaid");
    expect(readPayableStato(q("stato=paid"))).toBe("unpaid");
  });
});
