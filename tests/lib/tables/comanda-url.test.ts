import { describe, expect, it } from "vitest";
import { comandaHref, comandaSessionId } from "@/lib/tables/comanda-url";

// The comanda is one static page, /tavoli/comanda, and the session id rides in ?s= (M20 plan §3.6.4): the worker can serve that one page
// for a session that was opened with no connection.
const ID = "5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f";

describe("comandaHref", () => {
  it("is /tavoli/comanda?s=<id>", () => {
    expect(comandaHref(ID)).toBe(`/tavoli/comanda?s=${ID}`);
  });
});

describe("comandaSessionId", () => {
  it("reads a uuid from the s parameter", () => {
    expect(comandaSessionId(new URLSearchParams(`s=${ID}`))).toBe(ID);
    expect(comandaSessionId(new URLSearchParams(`x=1&s=${ID.toUpperCase()}`))).toBe(
      ID.toUpperCase(),
    );
  });

  it.each([["s=x"], ["s="], [""], [`s=${ID}extra`], ["s=1&s=2"], [`t=${ID}`], ["s=../../etc"]])(
    "is null for %j",
    (query) => {
      expect(comandaSessionId(new URLSearchParams(query))).toBeNull();
    },
  );

  it("is null with no parameters at all", () => {
    expect(comandaSessionId(null)).toBeNull();
  });
});
