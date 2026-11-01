import { describe, expect, it, vi } from "vitest";
import {
  AUTH_MIN_DURATION_MS,
  padToMinimum,
  withMinDuration,
  type Clock,
} from "@/server/auth/min-duration";

// A fake clock: sleep advances time and records the wait, so nothing really waits.
function fakeClock() {
  const state = { time: 1_000, slept: [] as number[] };
  const clock: Clock = {
    now: () => state.time,
    sleep: async (ms) => {
      state.slept.push(ms);
      state.time += ms;
    },
  };
  return { clock, state };
}

describe("padToMinimum", () => {
  it("pads a fast path up to the floor", async () => {
    const { clock, state } = fakeClock();
    const result = await padToMinimum(
      async () => {
        state.time += 50;
        return "ok";
      },
      800,
      clock,
    );
    expect(result).toBe("ok");
    expect(state.slept).toEqual([750]);
    expect(state.time).toBe(1_000 + 800);
  });

  it("does not add to a path already slower than the floor", async () => {
    const { clock, state } = fakeClock();
    await padToMinimum(
      async () => {
        state.time += 900;
      },
      800,
      clock,
    );
    expect(state.slept).toEqual([]);
  });

  it("floors an exception path too, and rethrows the same error", async () => {
    const { clock, state } = fakeClock();
    const boom = new Error("boom");
    await expect(
      padToMinimum(
        async () => {
          state.time += 10;
          throw boom;
        },
        800,
        clock,
      ),
    ).rejects.toBe(boom);
    expect(state.slept).toEqual([790]);
  });

  it("defaults to a floor that covers bcrypt plus a round trip, and to the real clock", async () => {
    expect(AUTH_MIN_DURATION_MS).toBeGreaterThanOrEqual(600);
    expect(AUTH_MIN_DURATION_MS).toBeLessThanOrEqual(1_000);
    vi.useFakeTimers();
    try {
      let done = false;
      const pending = padToMinimum(async () => "x").then(() => (done = true));
      await vi.advanceTimersByTimeAsync(AUTH_MIN_DURATION_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withMinDuration", () => {
  it("floors a route handler, passing its arguments and response through", async () => {
    const { clock, state } = fakeClock();
    const response = new Response("{}", { status: 401 });
    const handler = vi.fn(async (_request: Request) => {
      state.time += 20;
      return response;
    });
    const wrapped = withMinDuration(handler, 800, clock);
    const request = new Request("http://localhost/x", { method: "POST" });
    expect(await wrapped(request)).toBe(response);
    expect(handler).toHaveBeenCalledWith(request);
    expect(state.slept).toEqual([780]);
  });

  it.each([400, 415, 429])(
    "does not pad a %i: it is rejected before any account lookup or by an IP limit",
    async (status) => {
      const { clock, state } = fakeClock();
      const wrapped = withMinDuration(async () => new Response("{}", { status }), 800, clock);
      expect((await wrapped()).status).toBe(status);
      expect(state.slept).toEqual([]);
    },
  );

  it.each([200, 202, 401, 422, 502])("pads a %i", async (status) => {
    const { clock, state } = fakeClock();
    const wrapped = withMinDuration(async () => new Response("{}", { status }), 800, clock);
    expect((await wrapped()).status).toBe(status);
    expect(state.slept).toEqual([800]);
  });

  it("floors a handler that throws and rethrows", async () => {
    const { clock, state } = fakeClock();
    const wrapped = withMinDuration(
      async () => {
        throw new TypeError("nope");
      },
      800,
      clock,
    );
    await expect(wrapped()).rejects.toThrow("nope");
    expect(state.slept).toEqual([800]);
  });
});
