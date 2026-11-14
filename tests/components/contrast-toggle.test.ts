// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContrastToggle, useDeviceContrast } from "@/components/contrast-toggle";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

function prefersMoreContrast() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(prefers-contrast: more)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

describe("ContrastToggle", () => {
  it("is a button 'Alto contrasto' whose aria-pressed follows the state, 44 px tall", () => {
    const { rerender } = render(
      createElement(ContrastToggle, { high: false, onToggle: () => undefined }),
    );
    const button = screen.getByRole("button", { name: "Alto contrasto" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.className).toContain("min-h-tap");
    rerender(createElement(ContrastToggle, { high: true, onToggle: () => undefined }));
    expect(
      screen.getByRole("button", { name: "Alto contrasto" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("asks for the opposite state when pressed", () => {
    const onToggle = vi.fn();
    render(createElement(ContrastToggle, { high: false, onToggle }));
    fireEvent.click(screen.getByRole("button", { name: "Alto contrasto" }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("is a pressed secondary with a hidden check mark, never a primary", () => {
    const { rerender } = render(
      createElement(ContrastToggle, { high: false, onToggle: () => undefined }),
    );
    const off = screen.getByRole("button", { name: "Alto contrasto" });
    expect(off.getAttribute("data-on")).toBe("false");
    expect(off.classList.contains("bg-accent")).toBe(false);
    expect(off.querySelector('[aria-hidden="true"]')).toBeNull();
    rerender(createElement(ContrastToggle, { high: true, onToggle: () => undefined }));
    const on = screen.getByRole("button", { name: "Alto contrasto" });
    expect(on.getAttribute("data-on")).toBe("true");
    expect(on.classList.contains("bg-accent")).toBe(false);
    expect(on.querySelector('[aria-hidden="true"]')?.textContent).toBe("✓");
  });
});

describe("useDeviceContrast", () => {
  it("starts on when 'high' is stored", () => {
    window.localStorage.setItem("kitchen.contrast", "high");
    const { result } = renderHook(() => useDeviceContrast());
    expect(result.current[0]).toBe(true);
  });

  it("starts on when nothing is stored and the device asks for more contrast", () => {
    prefersMoreContrast();
    const { result } = renderHook(() => useDeviceContrast());
    expect(result.current[0]).toBe(true);
  });

  it("writes 'normal' under the device's single key when turned off", () => {
    window.localStorage.setItem("kitchen.contrast", "high");
    const { result } = renderHook(() => useDeviceContrast());
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem("kitchen.contrast")).toBe("normal");
  });

  it("on a device that refuses storage, starts from the device preference and still toggles for the visit", () => {
    prefersMoreContrast();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useDeviceContrast());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});
