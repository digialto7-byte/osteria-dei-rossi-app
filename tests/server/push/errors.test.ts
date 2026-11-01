import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { messages, t } from "@/lib/i18n";
import { mapPushDbError } from "@/server/push/errors";

const map = (code: string, message: string) => mapPushDbError({ code, message });

describe("mapPushDbError", () => {
  it.each([
    ["push_price_invalid", 422],
    ["push_price_above_menu", 422],
    ["menu_price_missing", 422],
    ["date_out_of_range", 422],
    ["date_in_future", 422],
    ["menu_item_inactive", 409],
  ])("P0001 %s is a %i with the same code", (message, status) => {
    const error = map("P0001", message);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).code).toBe(message);
  });

  it("P0002 menu_item_not_found is a 404 not_found", () => {
    const error = map("P0002", "menu_item_not_found") as ApiError;
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("42501 is a 403 and 22023 a 400", () => {
    expect((map("42501", "x") as ApiError).status).toBe(403);
    expect((map("22023", "invalid_request") as ApiError).status).toBe(400);
  });

  it("the messages are Italian and never the database's", () => {
    expect((map("P0001", "push_price_above_menu") as ApiError).message).toMatch(/prezzo del menu/);
    expect((map("P0001", "menu_item_inactive") as ApiError).message).toMatch(/non è attivo/);
    expect((map("P0001", "date_out_of_range") as ApiError).message).toMatch(/oggi/);
  });

  it("menu_price_missing has its own message, not the above-menu one (M24 follow-up)", () => {
    const text =
      "Questo piatto non ha un prezzo di menu in vigore: impostalo nel Menu prima di dargli un prezzo del giorno.";
    const error = map("P0001", "menu_price_missing") as ApiError;
    expect(error.message).toBe(t("pushError.menu_price_missing"));
    expect(error.message).toBe(text);
    expect(error.message).not.toMatch(/superare/);
    expect(error.message).not.toBe((map("P0001", "push_price_above_menu") as ApiError).message);
    expect(messages.en["pushError.menu_price_missing"]).toBe(
      "This dish has no menu price in force: set it in Menu before giving it a price of the day.",
    );
  });

  it("an unknown error is a plain Error that names only the SQLSTATE", () => {
    const error = map("XX000", "secret table name");
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.message).toBe("Unexpected database error XX000");
    expect(map("P0001", "something_else")).not.toBeInstanceOf(ApiError);
  });
});
