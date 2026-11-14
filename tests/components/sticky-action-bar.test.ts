// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StickyActionBar } from "@/components/sticky-action-bar";

afterEach(cleanup);
const bar = () => document.querySelector('[data-slot="sticky-action-bar"]') as HTMLElement;

describe("StickyActionBar", () => {
  it("sticks to the bottom and keeps clear of the home indicator", () => {
    render(createElement(StickyActionBar, null, createElement("button", null, "A")));
    expect(bar().classList.contains("sticky")).toBe(true);
    expect(bar().classList.contains("bottom-0")).toBe(true);
    expect(bar().className).toContain("env(safe-area-inset-bottom)");
  });

  it("two children share the row", () => {
    render(
      createElement(
        StickyActionBar,
        null,
        createElement("button", null, "A"),
        createElement("button", null, "B"),
      ),
    );
    const wrappers = Array.from(bar().children);
    expect(wrappers).toHaveLength(2);
    for (const wrapper of wrappers) expect(wrapper.classList.contains("flex-1")).toBe(true);
  });

  it("one child takes the full width", () => {
    render(createElement(StickyActionBar, null, createElement("button", null, "A")));
    expect(bar().children).toHaveLength(1);
    expect(bar().children[0]!.classList.contains("flex-1")).toBe(true);
  });

  it("skips a child that is false or null", () => {
    render(createElement(StickyActionBar, null, createElement("button", null, "A"), false, null));
    expect(bar().children).toHaveLength(1);
  });
});
