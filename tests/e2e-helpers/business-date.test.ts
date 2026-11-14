import { describe, expect, it, vi } from "vitest";
import { businessDateOf, parseBusinessDate } from "../../e2e/helpers/business-date";

describe("parseBusinessDate", () => {
  it("takes the end of the default range of the waste-costs answer", () => {
    expect(parseBusinessDate({ from: "2026-11-01", to: "2026-11-13", valueEur: 0 })).toBe(
      "2026-11-13",
    );
  });

  it.each([
    null,
    undefined,
    5,
    "2026-11-13",
    {},
    { to: null },
    { to: "13/11/2026" },
    { to: "2026-13-40" },
    // Rolled over to 2 March by Date, caught only by the round trip.
    { to: "2026-02-30" },
  ])("refuses %j", (body) => {
    expect(() => parseBusinessDate(body)).toThrow(/business date/i);
  });
});

describe("businessDateOf", () => {
  const owner = (status: number, body: unknown) => {
    const get = vi.fn(async () => ({
      status: () => status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    }));
    return { page: { request: { get } } as never, get };
  };

  it("asks the owner's own session for the default range, with no parameters", async () => {
    const { page, get } = owner(200, { from: "2026-11-01", to: "2026-11-13" });
    await expect(businessDateOf(page)).resolves.toBe("2026-11-13");
    expect(get).toHaveBeenCalledExactlyOnceWith("/api/stock/waste-costs");
  });

  it("says what the route answered when it is not a 200", async () => {
    const { page } = owner(403, { error: "forbidden" });
    await expect(businessDateOf(page)).rejects.toThrow(/403/);
  });
});
