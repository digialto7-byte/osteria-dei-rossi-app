// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RemainingCount } from "@/app/(owner)/cucina/remaining-count";

afterEach(cleanup);
const show = (remaining: number) => render(createElement(RemainingCount, { remaining }));

describe("RemainingCount", () => {
  it("shows Da fare: 7 with the number it was given", () => {
    const { container } = show(7);
    const node = container.querySelector("[data-remaining]")!;
    expect(node.textContent).toBe("Da fare: 7");
    expect(node.getAttribute("data-remaining")).toBe("7");
  });

  it("shows Tutto fatto at 0", () => {
    const { container } = show(0);
    const node = container.querySelector("[data-remaining]")!;
    expect(node.textContent).toBe("Tutto fatto");
    expect(node.getAttribute("data-remaining")).toBe("0");
  });

  it("is a status for screen readers and has no euro sign", () => {
    const { container } = show(3);
    expect(container.querySelector("[role=status]")).toBeNull();
    expect(container.textContent).not.toContain("€");
  });
});
