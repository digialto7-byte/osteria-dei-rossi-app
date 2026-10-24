import { describe, expect, it } from "vitest";
import { latestOnly } from "@/lib/api/latest";
import { fetchNewest } from "@/lib/counts/load-newest";

const later = <T>(value: T, ms: number) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("fetchNewest", () => {
  it("returns the value of a lone request", async () => {
    const start = latestOnly();
    expect(await fetchNewest(start, () => later("only", 1))).toBe("only");
  });

  it("ignores an older response that arrives after a newer one", async () => {
    const start = latestOnly();
    const applied: string[] = [];
    const run = async (name: string, ms: number) => {
      const value = await fetchNewest(start, () => later(name, ms));
      if (value !== null) applied.push(value);
    };
    // The first request is slow, the second fast: the slow (older) answer lands last and must not be applied.
    await Promise.all([run("older, slow", 20), run("newer, fast", 1)]);
    expect(applied).toEqual(["newer, fast"]);
  });

  it("applies both answers when the older one arrives first and is itself superseded only afterwards", async () => {
    const start = latestOnly();
    const first = await fetchNewest(start, () => later("first", 1));
    const second = await fetchNewest(start, () => later("second", 1));
    expect([first, second]).toEqual(["first", "second"]);
  });
});
