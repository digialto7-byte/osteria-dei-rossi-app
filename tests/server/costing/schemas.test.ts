import { describe, expect, it } from "vitest";
import { fixedCostBody } from "@/server/costing/schemas";

const BODY = { month: "2026-10", rentEur: 3000, labourEur: 9000, utilitiesEur: 1500 };

describe("fixedCostBody month", () => {
  it.each(["2026-10", "0001-01", "9999-12"])("accepts %j", (month) => {
    expect(fixedCostBody.safeParse({ ...BODY, month }).success).toBe(true);
  });

  it.each(["0000-01", "0000-12", "2026-13", "2026-00", "2026-10-01", "26-10", ""])(
    "rejects %j (a shape error, so a 400 before any RPC)",
    (month) => {
      expect(fixedCostBody.safeParse({ ...BODY, month }).success).toBe(false);
    },
  );
});
