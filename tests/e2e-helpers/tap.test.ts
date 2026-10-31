// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { smallTapTargets } from "../../e2e/helpers/tap";

afterEach(() => {
  document.body.innerHTML = "";
});

/** jsdom has no layout: give every element the box a test names (height by data-h, 100 wide). */
function layout() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-h]")) {
    const height = Number(el.dataset.h);
    el.getBoundingClientRect = () => ({ width: 100, height }) as DOMRect;
  }
}

describe("smallTapTargets (phone tap-size check)", () => {
  it("measures the label of a radio, not the dot inside it", () => {
    document.body.innerHTML = `<main><label data-h="44"><input type="radio" data-h="20"> A</label></main>`;
    layout();
    expect(smallTapTargets(44)).toEqual([]);
  });

  it("fails a small label that wraps a radio", () => {
    document.body.innerHTML = `<main><label data-h="30"><input type="radio" data-h="20"> A</label></main>`;
    layout();
    expect(smallTapTargets(44)).toHaveLength(1);
  });

  it("fails a visible radio that has no wrapping label", () => {
    document.body.innerHTML = `<main><input type="radio" data-h="20"></main>`;
    layout();
    expect(smallTapTargets(44)).toHaveLength(1);
  });

  it("ignores a radio that is not visible", () => {
    document.body.innerHTML = `<main><input type="radio" data-h="0"></main>`;
    layout();
    expect(smallTapTargets(44)).toEqual([]);
  });
});
