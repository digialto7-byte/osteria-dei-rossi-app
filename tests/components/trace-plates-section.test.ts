// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatesSection } from "@/app/(owner)/tracciabilita/trace-parts";

// Fixture dates are in 1998 (the no-date-bombs guard).
const plate = {
  businessDate: "1998-11-14",
  name: "Lasagne Demo",
  lines: 2,
  portions: 2,
  firstAt: "1998-11-14T11:40:00.000Z",
  lastAt: "1998-11-14T13:55:00.000Z",
  via: "batch" as const,
};

afterEach(cleanup);

describe("PlatesSection", () => {
  it("renders two dishes with the same name on the same day as two rows, with no duplicate key", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(
      createElement(PlatesSection, {
        plates: [
          { ...plate, menuItemId: "00000000-0000-4000-8000-000000000001" },
          { ...plate, menuItemId: "00000000-0000-4000-8000-000000000002", lines: 5, portions: 5 },
        ],
        truncated: false,
      }),
    );
    expect(view.container.querySelectorAll("li")).toHaveLength(2);
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key|unique "key"/);
    error.mockRestore();
  });
});
