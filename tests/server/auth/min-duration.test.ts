import { describe, expect, it, vi } from "vitest";
import {
  AUTH_MIN_DURATION_MS,
  authFloorMs,
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

// The local e2e stack signs in about 135 times per run; paying the floor on each pushed the heavy job past its cap
// (run 41357522363). The floor may be switched off only for a Supabase on this machine, never for a hosted one.
describe("authFloorMs", () => {
  const LOCAL = "http://127.0.0.1:54321";

  it("is the floor by default", () => {
    expect(authFloorMs({ NEXT_PUBLIC_SUPABASE_URL: LOCAL })).toBe(AUTH_MIN_DURATION_MS);
    expect(authFloorMs({})).toBe(AUTH_MIN_DURATION_MS);
  });

  it.each([LOCAL, "http://localhost:54321", "http://[::1]:54321"])(
    "is 0 when the e2e switch is on and Supabase is local (%s)",
    (url) => {
      expect(authFloorMs({ E2E_AUTH_FLOOR_OFF: "1", NEXT_PUBLIC_SUPABASE_URL: url })).toBe(0);
    },
  );

  it.each([
    "https://abcdefghijklmnop.supabase.co",
    "https://127.0.0.1.example.com",
    "https://localhost.example.com",
    "not a url",
    undefined,
  ])("keeps the floor for a Supabase that is not local, even with the switch on (%s)", (url) => {
    expect(authFloorMs({ E2E_AUTH_FLOOR_OFF: "1", NEXT_PUBLIC_SUPABASE_URL: url })).toBe(
      AUTH_MIN_DURATION_MS,
    );
  });

  it("only the exact value 1 switches it off", () => {
    for (const value of ["true", "yes", "0", ""]) {
      expect(authFloorMs({ E2E_AUTH_FLOOR_OFF: value, NEXT_PUBLIC_SUPABASE_URL: LOCAL })).toBe(
        AUTH_MIN_DURATION_MS,
      );
    }
  });

  it("withMinDuration reads the floor per request when none is given", async () => {
    const clock = { now: () => 0, sleep: vi.fn(async () => undefined) };
    const wrapped = withMinDuration(
      async () => new Response("{}", { status: 200 }),
      undefined,
      clock,
    );
    await wrapped();
    expect(clock.sleep).toHaveBeenCalledWith(AUTH_MIN_DURATION_MS);
  });
});
