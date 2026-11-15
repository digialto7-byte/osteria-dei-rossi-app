// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveGridScroll, takeGridScroll } from "@/lib/tables/grid-scroll";

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
