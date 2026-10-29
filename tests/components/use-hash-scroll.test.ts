// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHashScroll } from "@/components/use-hash-scroll";

// UX plan C4: a facet link ends in #<row id>; the row arrives from /api/* after the page opens, so the page scrolls to it
// when the list is ready.

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  document.body.innerHTML = '<div id="rule-ingredient-1"></div>';
});
afterEach(() => {
  window.location.hash = "";
});

describe("useHashScroll", () => {
  it("scrolls to the element named by the hash once the list is ready", () => {
    window.location.hash = "#rule-ingredient-1";
    const { rerender } = renderHook(({ ready }) => useHashScroll(ready), {
      initialProps: { ready: false },
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("rule-ingredient-1"));
  });

  it("does nothing without a hash, or when no element has that id", () => {
    renderHook(() => useHashScroll(true));
    window.location.hash = "#missing";
    renderHook(() => useHashScroll(true));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
