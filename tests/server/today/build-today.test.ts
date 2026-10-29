import { describe, expect, it } from "vitest";
import { alertsCard, buildTodaySummary } from "@/server/today/summary";
import { todaySchema } from "@/server/today/types";
import { COUNTS } from "../../fixtures/dashboard-sql";

describe("buildTodaySummary", () => {
  it("owner: the alerts card comes first, then the five count cards and the set-up list", () => {
    const summary = buildTodaySummary(COUNTS, alertsCard(7, false), "owner");
    expect(todaySchema.safeParse(summary).success).toBe(true);
    expect(summary.cards.map((c) => c.key)).toEqual([
      "alerts",
      "invoicesToReview",
      "payablesOverdue",
      "payablesUnpaid",
      "batchesUseBy",
      "countOpen",
    ]);
    expect(summary.cards[0]).toEqual({ key: "alerts", count: 7, more: false, href: "/avvisi" });
    expect(summary.cards.find((c) => c.key === "countOpen")?.count).toBe(1);
    expect(summary.setup).toHaveLength(8);
    expect(summary.setup?.find((s) => s.key === "staff")?.done).toBe(false);
  });

  it("admin: no alerts card", () => {
    const summary = buildTodaySummary(COUNTS, null, "admin");
    expect(summary.cards.map((c) => c.key)).not.toContain("alerts");
    expect(summary.cards).toHaveLength(5);
    expect(summary.setup).toHaveLength(8);
  });

  it("owner without an alerts card is refused by the type, and by the result: no card is invented", () => {
    const summary = buildTodaySummary(COUNTS, null, "owner");
    expect(summary.cards.map((c) => c.key)).not.toContain("alerts");
  });

  it("chef: alerts, batches and the count flag; no set-up list", () => {
    const summary = buildTodaySummary(
      { batchesUseBy: 3, countOpen: false },
      alertsCard(1, true),
      "chef",
    );
    expect(summary.cards.map((c) => [c.key, c.count, c.more])).toEqual([
      ["alerts", 1, true],
      ["batchesUseBy", 3, false],
      ["countOpen", 0, false],
    ]);
    expect(summary.setup).toBeNull();
  });
});
