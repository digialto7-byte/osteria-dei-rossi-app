import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "@/server/extraction/prompt";

describe("SYSTEM_PROMPT", () => {
  it("tells the model an absent field is null with confidence 1", () => {
    expect(SYSTEM_PROMPT).toMatch(/absent[^.]*null[^.]*confidence of 1/i);
  });

  it("names the seller (cedente/prestatore) as the supplier and never the buyer", () => {
    expect(SYSTEM_PROMPT).toMatch(/cedente\/prestatore/i);
    expect(SYSTEM_PROMPT).toMatch(/cessionario\/committente/i);
    expect(SYSTEM_PROMPT).toMatch(/never the buyer/i);
  });
});
