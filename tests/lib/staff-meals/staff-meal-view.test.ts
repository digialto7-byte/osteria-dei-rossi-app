import { describe, expect, it } from "vitest";
import { confirmedLine, ruleLine } from "@/lib/staff-meals/staff-meal-view";

const RULE = {
  ruleId: "5a000000-0000-4000-8000-0000000000a1",
  kind: "recipe" as const,
  targetId: "ec000000-0000-4000-8000-0000000000e1",
  name: "Ragù (demo)",
  unit: "porzioni",
  defaultCount: 2,
  locationId: null,
  isActive: true,
  available: 6,
  today: null,
};

describe("ruleLine", () => {
  it("words a recipe rule in portions", () => {
    expect(ruleLine(RULE)).toBe("Ragù (demo) · 2 porzioni");
    expect(ruleLine({ ...RULE, defaultCount: 1 })).toBe("Ragù (demo) · 1 porzione");
    expect(ruleLine(RULE, "en")).toBe("Ragù (demo) · 2 portions");
  });

  it("words an ingredient rule with its unit and the Italian decimal comma", () => {
    const pane = {
      ...RULE,
      kind: "ingredient" as const,
      name: "Pane (demo)",
      unit: "kg",
      defaultCount: 0.5,
    };
    expect(ruleLine(pane)).toBe("Pane (demo) · 0,5 kg");
    expect(ruleLine(pane, "en")).toBe("Pane (demo) · 0.5 kg");
    expect(ruleLine({ ...pane, unit: "pz", defaultCount: 12 })).toBe("Pane (demo) · 12 pz");
  });
});

describe("confirmedLine", () => {
  const today = {
    confirmationId: "5c000000-0000-4000-8000-0000000000c1",
    count: 2,
    at: "2026-10-24T10:10:00Z",
    byInitials: "CD",
  };

  it("says the time in Europe/Rome and who confirmed", () => {
    expect(confirmedLine(today)).toBe("Confermato alle 12:10 · CD");
    expect(confirmedLine(today, "en")).toBe("Confirmed at 12:10 · CD");
  });

  it("follows the clock change: 01:30Z on 25 October is 02:30 in Rome, winter time", () => {
    expect(confirmedLine({ ...today, at: "2026-10-25T01:30:00Z" })).toBe(
      "Confermato alle 02:30 · CD",
    );
    expect(confirmedLine({ ...today, at: "2026-10-24T22:30:00Z" })).toBe(
      "Confermato alle 00:30 · CD",
    );
  });
});
