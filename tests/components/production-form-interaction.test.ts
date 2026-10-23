// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProductionForm,
  type ProduceRequest,
} from "@/app/(owner)/produzione/nuova/production-form";
import type { BatchProposal } from "@/server/batches/types";
import { KEY, PROPOSAL } from "./batch-fixtures";

const OTHER_KEY = "ec000000-0000-4000-8000-0000000000e2";
const RECIPES = [
  { key: KEY, name: "Spezzatino (demo)" },
  { key: OTHER_KEY, name: "Brodo (demo)" },
];

afterEach(cleanup);

function mount(proposal: BatchProposal = PROPOSAL) {
  const onSubmit = vi.fn<(request: ProduceRequest) => void>();
  const onCalculate = vi.fn();
  render(
    createElement(ProductionForm, {
      recipes: RECIPES,
      proposal,
      busy: false,
      error: null,
      errorIngredientIds: [],
      onCalculate,
      onShelfLife: () => {},
      onSubmit,
    }),
  );
  return { onSubmit, onCalculate };
}

const field = <T extends HTMLElement = HTMLInputElement>(name: string) =>
  document.querySelector(`[name="${name}"]`) as T;
const submitButton = () => screen.getByRole("button", { name: "Registra produzione" });
const hint = "La ricetta o la quantità sono cambiate: premi Calcola per aggiornare la proposta.";

describe("ProductionForm: the proposal belongs to the recipe and the output it was computed for", () => {
  it("submits the proposal's own recipe and output when nothing was changed", () => {
    const { onSubmit } = mount();
    expect(submitButton()).toHaveProperty("disabled", false);
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      recipeId: PROPOSAL.recipe.id,
      outputQty: 6.2,
    });
  });

  it("scenario 1: a changed output disables the button, shows the hint and never submits", () => {
    const { onSubmit } = mount();
    fireEvent.change(field("output"), {
      target: { value: "6,3" },
    });
    expect(submitButton()).toHaveProperty("disabled", true);
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.submit(screen.getByRole("form", { name: "Nuova produzione" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("scenario 2: another recipe in the dropdown disables the button and never submits", () => {
    const { onSubmit } = mount();
    fireEvent.change(field("recipe"), {
      target: { value: OTHER_KEY },
    });
    expect(submitButton()).toHaveProperty("disabled", true);
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.submit(screen.getByRole("form", { name: "Nuova produzione" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("typing the original output back makes the proposal valid again", () => {
    const { onSubmit } = mount();
    const output = field("output");
    fireEvent.change(output, { target: { value: "6,3" } });
    fireEvent.change(output, { target: { value: "6,20" } });
    expect(submitButton()).toHaveProperty("disabled", false);
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
