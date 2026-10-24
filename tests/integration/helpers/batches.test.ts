import { describe, expect, it, vi } from "vitest";
import { seedRaguBatch } from "./batches";

// CI's stack has two active locations by the time the Ragù batches are produced, and the M14 production route refuses
// an ambiguous location (422 location_required) for the batch and for every input. The helper must name the cellar.
describe("seedRaguBatch", () => {
  it("names the location on the batch and on every input, so a two-location tenant is not ambiguous", async () => {
    const produce = vi.fn(async (_body: object) => ({
      status: 201,
      body: { batchId: "b1", lotCode: "L", portions: 10 },
    }));
    await seedRaguBatch("beef-id", "ragu-recipe-id", "cella-id", produce);
    expect(produce).toHaveBeenCalledWith({
      recipeId: "ragu-recipe-id",
      outputQty: 2,
      locationId: "cella-id",
      inputs: [{ ingredientId: "beef-id", qty: 2, unit: "kg", locationId: "cella-id" }],
    });
  });
});
