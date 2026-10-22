import { describe, expect, it } from "vitest";
import { latestOnly } from "@/lib/api/latest";

describe("latestOnly", () => {
  it("lets the newest request through and drops the ones it overtook", () => {
    const start = latestOnly();
    const first = start();
    const second = start();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("keeps a lone request current", () => {
    const start = latestOnly();
    const only = start();
    expect(only()).toBe(true);
    expect(only()).toBe(true);
  });

  it("makes an earlier request stale as soon as a later one starts, even if it answers last", async () => {
    const start = latestOnly();
    const applied: string[] = [];
    const run = async (name: string, delay: number) => {
      const isCurrent = start();
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (isCurrent()) applied.push(name);
    };
    await Promise.all([run("slow", 20), run("fast", 1)]);
    expect(applied).toEqual(["fast"]);
  });
});
