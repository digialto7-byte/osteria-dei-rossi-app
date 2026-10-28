import { describe, expect, it } from "vitest";
import { canReadInvoices } from "@/lib/invoices/invoice-access";

// Mirrors GET /api/invoices: roles ["owner", "admin"].
describe("canReadInvoices", () => {
  it.each(["owner", "admin"])("allows the %s", (role) => {
    expect(canReadInvoices(role)).toBe(true);
  });
  it.each(["chef", "waiter", "", "unknown"])("refuses %j", (role) => {
    expect(canReadInvoices(role)).toBe(false);
  });
});
