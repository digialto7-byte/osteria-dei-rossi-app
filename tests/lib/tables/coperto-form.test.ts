import { describe, expect, it } from "vitest";
import { copertoBodyFromForm, copertoFormFromRead } from "@/lib/tables/coperto-form";

describe("copertoFormFromRead", () => {
  it("shows a set coperto with a decimal comma and its own rate", () => {
    expect(copertoFormFromRead({ amount: 1.5, vatRate: 10 }, 22)).toEqual({
      amount: "1,50",
      vatRate: "10",
    });
  });
  it("an unset coperto has an empty amount and the default rate", () => {
    expect(copertoFormFromRead(null, 22)).toEqual({ amount: "", vatRate: "22" });
  });
  it("no coperto and no default rate leave the rate empty", () => {
    expect(copertoFormFromRead(null, null)).toEqual({ amount: "", vatRate: "" });
  });
});

describe("copertoBodyFromForm", () => {
  it("an empty amount clears the coperto (both null), whatever the rate shows", () => {
    expect(copertoBodyFromForm({ amount: "  ", vatRate: "10" })).toEqual({
      ok: true,
      body: { copertoAmount: null, copertoVatRate: null },
    });
  });
  it("an amount and a rate are sent as numbers", () => {
    expect(copertoBodyFromForm({ amount: "1,50", vatRate: "10" })).toEqual({
      ok: true,
      body: { copertoAmount: 1.5, copertoVatRate: 10 },
    });
    expect(copertoBodyFromForm({ amount: "100", vatRate: "22" })).toMatchObject({ ok: true });
    expect(copertoBodyFromForm({ amount: "0.01", vatRate: "0" })).toEqual({
      ok: true,
      body: { copertoAmount: 0.01, copertoVatRate: 0 },
    });
  });
  it.each([
    ["zero", { amount: "0", vatRate: "10" }],
    ["above 100", { amount: "100,01", vatRate: "10" }],
    ["3 decimals", { amount: "1,505", vatRate: "10" }],
    ["text", { amount: "uno", vatRate: "10" }],
    ["a negative amount", { amount: "-1", vatRate: "10" }],
    ["an amount without a rate", { amount: "1,50", vatRate: "" }],
    ["a rate that is not allowed", { amount: "1,50", vatRate: "12" }],
  ])("refuses %s with the Italian message", (_name, form) => {
    expect(copertoBodyFromForm(form)).toEqual({
      ok: false,
      error: "Il coperto va da 0,01 a 100,00 € e ha bisogno della sua aliquota IVA.",
    });
  });
});
