import { describe, expect, it } from "vitest";
import { formatServerTiming, measured } from "@/server/orders/timing";

/** A clock that returns the given readings one after the other. */
const clock = (...readings: number[]) => {
  let index = 0;
  return () => readings[Math.min(index++, readings.length - 1)]!;
};

describe("formatServerTiming", () => {
  it("writes auth, rpc and total with one decimal", () => {
    expect(formatServerTiming({ auth: 12.345, rpc: 40, total: 55.57 })).toBe(
      "auth;dur=12.3, rpc;dur=40.0, total;dur=55.6",
    );
  });

  it("never writes a negative or non-finite duration", () => {
    expect(formatServerTiming({ auth: -1, rpc: Number.NaN, total: Infinity })).toBe(
      "auth;dur=0.0, rpc;dur=0.0, total;dur=0.0",
    );
  });
});

describe("measured", () => {
  it("returns the result and the header from the injected clock", async () => {
    // request started at 100, auth done at 112.5; the run starts at 113 and ends at 153; the clock is read twice.
    const { result, header } = await measured(
      { startedAt: 100, authDoneAt: 112.5 },
      async () => "ok",
      clock(113, 153),
    );
    expect(result).toBe("ok");
    expect(header).toBe("auth;dur=12.5, rpc;dur=40.0, total;dur=53.0");
  });

  it("passes a failure on without a header", async () => {
    await expect(
      measured(
        { startedAt: 0, authDoneAt: 1 },
        async () => Promise.reject(new Error("x")),
        clock(2, 3),
      ),
    ).rejects.toThrow("x");
  });
});
