// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListFilters } from "@/components/list-filters";

afterEach(cleanup);

// M25b step 10 (plan §3.5): the shared "Filtri" control of Fatture and Pagamenti. Controlled: it holds no state and calls back.
const A = { id: "5a000000-0000-4000-8000-00000000005a", name: "Fornitore Demo A" };
const B = { id: "5c000000-0000-4000-8000-00000000005c", name: "Fornitore Demo B" };
type Filters = { dal: string | null; al: string | null; fornitore: string | null };
const NONE: Filters = { dal: null, al: null, fornitore: null };

function show(
  filters: Filters = NONE,
  extra: { hint?: string } = {},
  handlers = { onChange: vi.fn(), onReset: vi.fn() },
) {
  render(createElement(ListFilters, { filters, suppliers: [B, A], ...handlers, ...extra }));
  return handlers;
}

describe("ListFilters", () => {
  it("is a group named Filtri with Dal, Al and Fornitore", () => {
    show();
    const group = screen.getByRole("group", { name: "Filtri" });
    expect(within(group).getByLabelText("Dal")).toHaveProperty("type", "date");
    expect(within(group).getByLabelText("Al")).toHaveProperty("type", "date");
    expect(within(group).getByLabelText("Fornitore")).toHaveProperty("tagName", "SELECT");
  });

  it("lists Tutti i fornitori first, then the suppliers in the order received", () => {
    show();
    const options = [...screen.getByLabelText("Fornitore").querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual([
      "Tutti i fornitori",
      "Fornitore Demo B",
      "Fornitore Demo A",
    ]);
    expect(options[0]!.value).toBe("");
  });

  it("links the two dates with min and max", () => {
    show({ dal: "2026-11-01", al: "2026-11-30", fornitore: null });
    expect(screen.getByLabelText("Dal").getAttribute("max")).toBe("2026-11-30");
    expect(screen.getByLabelText("Al").getAttribute("min")).toBe("2026-11-01");
    cleanup();
    show();
    expect(screen.getByLabelText("Dal").getAttribute("max")).toBeNull();
    expect(screen.getByLabelText("Al").getAttribute("min")).toBeNull();
  });

  it("shows the current values", () => {
    show({ dal: "2026-11-01", al: "2026-11-30", fornitore: A.id });
    expect((screen.getByLabelText("Dal") as HTMLInputElement).value).toBe("2026-11-01");
    expect((screen.getByLabelText("Al") as HTMLInputElement).value).toBe("2026-11-30");
    expect((screen.getByLabelText("Fornitore") as HTMLSelectElement).value).toBe(A.id);
  });

  it("calls onChange with the new filters for each field", () => {
    const { onChange } = show({ dal: "2026-11-01", al: null, fornitore: null });
    fireEvent.change(screen.getByLabelText("Al"), { target: { value: "2026-11-30" } });
    expect(onChange).toHaveBeenLastCalledWith({
      dal: "2026-11-01",
      al: "2026-11-30",
      fornitore: null,
    });
    fireEvent.change(screen.getByLabelText("Dal"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ dal: null, al: null, fornitore: null });
    fireEvent.change(screen.getByLabelText("Fornitore"), { target: { value: A.id } });
    expect(onChange).toHaveBeenLastCalledWith({ dal: "2026-11-01", al: null, fornitore: A.id });
    fireEvent.change(screen.getByLabelText("Fornitore"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ dal: "2026-11-01", al: null, fornitore: null });
  });

  it("has no Azzera filtri without a filter", () => {
    show();
    expect(screen.queryByRole("button", { name: "Azzera filtri" })).toBeNull();
  });

  it.each([
    { dal: "2026-11-01", al: null, fornitore: null },
    { dal: null, al: "2026-11-01", fornitore: null },
    { dal: null, al: null, fornitore: A.id },
  ])("shows a 44 px Azzera filtri for %j and calls onReset once", (filters) => {
    const { onReset } = show(filters);
    const button = screen.getByRole("button", { name: "Azzera filtri" });
    expect(button.className).toContain("min-h-tap");
    fireEvent.click(button);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders an optional hint under the dates", () => {
    show(NONE, { hint: "Date di scadenza" });
    expect(screen.getByText("Date di scadenza")).toBeTruthy();
    cleanup();
    show();
    expect(screen.queryByText("Date di scadenza")).toBeNull();
  });

  it("keeps the dates in two columns from sm and one on a phone", () => {
    show();
    const grid = screen.getByLabelText("Dal").closest("div")!;
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("grid-cols-1");
  });
});
