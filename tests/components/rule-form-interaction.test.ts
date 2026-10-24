// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuleForm, type RuleValues } from "@/app/(owner)/produzione/personale/rule-form";
import { CELLA, DISPENSA, PANE_ID } from "./batch-fixtures";

afterEach(cleanup);

const PLACES = [
  { id: CELLA, name: "Cella (demo)" },
  { id: DISPENSA, name: "Dispensa (demo)" },
];

function mount(locations: readonly { id: string; name: string }[]) {
  const onSubmit = vi.fn<(values: RuleValues) => Promise<boolean>>(async () => true);
  render(
    createElement(RuleForm, {
      recipes: [],
      ingredients: [{ id: PANE_ID, name: "Pane (demo)", baseUnit: "kg" }],
      locations,
      busy: false,
      error: null,
      invalidField: null,
      onSubmit,
      initialKind: "ingredient",
      initialTarget: PANE_ID,
    }),
  );
  fireEvent.change(document.querySelector('[name="count"]')!, { target: { value: "0,5" } });
  return onSubmit;
}
const save = () =>
  fireEvent.submit(screen.getByRole("button", { name: "Salva regola" }).closest("form")!);

describe("RuleForm, an ingredient rule on a two-location tenant", () => {
  it("does not submit without a location, and says so on the location field", () => {
    const onSubmit = mount(PLACES);
    save();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.querySelector('[name="location"]')!.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Indica l'ubicazione.");
  });

  it("submits the chosen location", () => {
    const onSubmit = mount(PLACES);
    fireEvent.change(document.querySelector('[name="location"]')!, { target: { value: DISPENSA } });
    save();
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "ingredient",
      ingredientId: PANE_ID,
      defaultCount: 0.5,
      unit: "kg",
      locationId: DISPENSA,
    });
  });

  it("with a single location nothing is asked and no locationId is sent (SQL stores the only one)", () => {
    const onSubmit = mount([PLACES[0]!]);
    save();
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "ingredient",
      ingredientId: PANE_ID,
      defaultCount: 0.5,
      unit: "kg",
    });
  });
});
