// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProductionForm,
  type ProduceRequest,
} from "@/app/(owner)/produzione/nuova/production-form";
import type { BatchProposal } from "@/server/batches/types";
import { BEEF_INPUT, CELLA, DISPENSA, KEY, PROPOSAL, TWO_LOCATIONS } from "./batch-fixtures";

const RECIPES = [{ key: KEY, name: "Spezzatino (demo)" }];

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

describe("ProductionForm: the place of each ingredient with two locations", () => {
  // As batch_proposal sends it with two or more locations: no suggestion for the batch itself.
  const noSuggestion: BatchProposal = {
    ...PROPOSAL,
    locations: TWO_LOCATIONS,
    suggestedLocationId: null,
    inputs: [{ ...BEEF_INPUT, suggestedLocationId: null, onHand: [] }],
  };

  it("offers an empty choose option, selected, and blocks the submit until a place is chosen", () => {
    const { onSubmit } = mount(noSuggestion);
    const place = field<HTMLSelectElement>("location");
    expect(place.value).toBe("");
    expect([...place.options].map((o) => o.text)).toEqual([
      "Scegli l'ubicazione",
      "Cella (demo)",
      "Dispensa (demo)",
    ]);
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Scegli l'ubicazione di ogni ingrediente usato e del lotto.",
    );

    fireEvent.change(place, { target: { value: DISPENSA } });
    fireEvent.change(field<HTMLSelectElement>("batchLocation"), { target: { value: CELLA } });
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].inputs[0]).toMatchObject({ locationId: DISPENSA });
  });

  it("asks for the batch location too: empty choose option, no submit, then locationId is sent", () => {
    const { onSubmit } = mount(noSuggestion);
    fireEvent.change(field<HTMLSelectElement>("location"), { target: { value: DISPENSA } });
    const batchPlace = field<HTMLSelectElement>("batchLocation");
    expect(batchPlace.value).toBe("");
    expect(batchPlace.options[0]!.text).toBe("Scegli l'ubicazione");

    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Scegli l'ubicazione di ogni ingrediente usato e del lotto.",
    );

    fireEvent.change(batchPlace, { target: { value: CELLA } });
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ locationId: CELLA });
  });

  it("does not ask for a place for an ingredient used at quantity 0", () => {
    const { onSubmit } = mount(noSuggestion);
    fireEvent.change(field("qty"), {
      target: { value: "0" },
    });
    fireEvent.change(field<HTMLSelectElement>("batchLocation"), { target: { value: CELLA } });
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].inputs[0]).not.toHaveProperty("locationId");
  });

  it("keeps the suggested place selected when there is one", () => {
    mount({ ...noSuggestion, inputs: [{ ...BEEF_INPUT, suggestedLocationId: CELLA }] });
    const place = field<HTMLSelectElement>("location");
    expect(place.value).toBe(CELLA);
    expect([...place.options].map((o) => o.text)).not.toContain("Scegli l'ubicazione");
  });
});
