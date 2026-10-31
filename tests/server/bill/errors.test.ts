import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapBillDbError } from "@/server/bill/errors";
import { BIDS } from "../../helpers/bill-data";

const map = (code: string, message: string, details?: string | null) =>
  mapBillDbError({ code, message, details });

describe("mapBillDbError", () => {
  it("42501 is a 403 and 22023 a 400", () => {
    expect(map("42501", "x")).toMatchObject({ status: 403, code: "forbidden" });
    expect(map("22023", "invalid_request")).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("P0002 session_not_found is a 404 with an Italian text", () => {
    expect(map("P0002", "session_not_found")).toMatchObject({
      status: 404,
      code: "not_found",
      message: "Sessione non trovata.",
    });
  });

  it.each([
    ["session_closed", 409],
    ["bill_changed", 409],
    ["unsent_lines", 409],
    ["split_invalid", 422],
    ["receipt_number_invalid", 422],
    ["receipt_type_invalid", 422],
    ["payment_type_invalid", 422],
  ])("P0001 %s is a %i with the same code and an Italian text", (code, status) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect([mapped.status, mapped.code]).toEqual([status, code]);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
  });

  it("parts_invalid is a 400: the schema should have stopped it", () => {
    expect(map("P0001", "parts_invalid")).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("unsent_lines carries the line ids from the DETAIL", () => {
    const mapped = map(
      "P0001",
      "unsent_lines",
      JSON.stringify({ lineIds: [BIDS.line1] }),
    ) as ApiError;
    expect(mapped.details).toEqual({ lineIds: [BIDS.line1] });
  });

  it("an unsent_lines DETAIL with any other key is dropped whole", () => {
    const mapped = map(
      "P0001",
      "unsent_lines",
      JSON.stringify({ lineIds: [BIDS.line1], name: "Mario" }),
    ) as ApiError;
    expect(mapped.code).toBe("unsent_lines");
    expect(mapped.details).toBeUndefined();
  });

  it("an unsent_lines DETAIL with a non-uuid, a non-array or garbage is dropped", () => {
    for (const detail of [
      JSON.stringify({ lineIds: ["x"] }),
      JSON.stringify({ lineIds: BIDS.line1 }),
      "not json",
      null,
    ]) {
      expect((map("P0001", "unsent_lines", detail) as ApiError).details).toBeUndefined();
    }
  });

  it("split_invalid carries only the reason", () => {
    const mapped = map(
      "P0001",
      "split_invalid",
      JSON.stringify({ reason: "line_twice" }),
    ) as ApiError;
    expect(mapped.details).toEqual({ reason: "line_twice" });
    expect(
      (map("P0001", "split_invalid", JSON.stringify({ reason: "other" })) as ApiError).details,
    ).toBeUndefined();
    expect(
      (
        map(
          "P0001",
          "split_invalid",
          JSON.stringify({ reason: "line_twice", lineId: BIDS.line1 }),
        ) as ApiError
      ).details,
    ).toBeUndefined();
  });

  it("an unknown error is a plain Error naming only the SQLSTATE", () => {
    const mapped = map("XX000", "secret internals");
    expect(mapped).not.toBeInstanceOf(ApiError);
    expect(mapped.message).toBe("Unexpected database error XX000");
  });
});
