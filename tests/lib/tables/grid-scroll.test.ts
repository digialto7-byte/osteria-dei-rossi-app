// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreGridScroll, saveGridScroll, takeGridScroll } from "@/lib/tables/grid-scroll";

// The grid of tables keeps its scroll position across a visit to a comanda (P2b-7, plan D12, Q-L5d): saved on the tap, taken once on the way back.

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("grid scroll", () => {
  it("saves the offset under tavoli.scroll and takes it once", () => {
    saveGridScroll(312);
    expect(window.sessionStorage.getItem("tavoli.scroll")).toBe("312");
    expect(takeGridScroll()).toBe(312);
    expect(takeGridScroll()).toBeNull();
    expect(window.sessionStorage.getItem("tavoli.scroll")).toBeNull();
  });

  it("keeps the last offset when saved twice", () => {
    saveGridScroll(10);
    saveGridScroll(20);
    expect(takeGridScroll()).toBe(20);
  });

  it("ignores a value that is not a number, and saves nothing for one", () => {
    window.sessionStorage.setItem("tavoli.scroll", "abc");
    expect(takeGridScroll()).toBeNull();
    saveGridScroll(Number.NaN);
    saveGridScroll(-5);
    expect(window.sessionStorage.getItem("tavoli.scroll")).toBeNull();
  });

  it("is null with nothing saved", () => {
    expect(takeGridScroll()).toBeNull();
  });

  it("a sessionStorage that refuses gives null and saves nothing: the grid still works, at the top", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => saveGridScroll(5)).not.toThrow();
    expect(takeGridScroll()).toBeNull();
  });
});

// The page can still grow after its first render with tiles (a grid row, a banner, a notice): a single scrollTo is then clamped to the
// shorter page and the grid comes back too high (main CI, #136 on f5c679d: 108 px short). The restore follows the page until it can
// reach the offset, and never fights the waiter or runs forever.
describe("restoreGridScroll", () => {
  let height = 0;
  let resized: (() => void) | null = null;
  const scrollTo = vi.fn((_x: number, y: number) => {
    Object.defineProperty(window, "scrollY", {
      value: Math.min(y, height - 740),
      configurable: true,
    });
  });
  beforeEach(() => {
    vi.useFakeTimers();
    scrollTo.mockClear();
    Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 740, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      get: () => height,
      configurable: true,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {
          resized = null;
        }
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const grow = (to: number) => {
    height = to;
    resized?.();
  };

  it("a page already tall enough is scrolled once and not followed", () => {
    height = 1500;
    restoreGridScroll(400);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 400);
    expect(resized).toBeNull();
  });

  it("a page that grows after the first render is followed until the offset is reached", () => {
    height = 1032; // max scroll 292: the first scrollTo is clamped
    restoreGridScroll(400);
    expect(window.scrollY).toBe(292);
    grow(1140); // max scroll 400
    expect(window.scrollY).toBe(400);
    expect(resized).toBeNull();
    grow(1600);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("stops at the waiter's first input, so it never fights a scroll by hand", () => {
    height = 1032;
    restoreGridScroll(400);
    window.dispatchEvent(new Event("touchstart"));
    grow(1600);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("gives up after 3 s, and the returned stop ends it at once", () => {
    height = 1032;
    restoreGridScroll(400);
    vi.advanceTimersByTime(3000);
    grow(1600);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    height = 1032;
    const stop = restoreGridScroll(400);
    stop();
    grow(1600);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
