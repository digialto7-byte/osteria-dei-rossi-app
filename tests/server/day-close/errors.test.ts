import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapDayCloseDbError } from "@/server/day-close/errors";

const map = (code: string, message: string) => mapDayCloseDbError({ code, message });

describe("mapDayCloseDbError", () => {
  it("42501 is a 403 with the owner-only text", () => {
    expect(map("42501", "x")).toMatchObject({
      status: 403,
      code: "forbidden",
      message: "La chiusura di cassa è riservata al titolare.",
    });
  });
  it("22023 is a 400", () => {
    expect(map("22023", "invalid_request")).toMatchObject({ status: 400, code: "invalid_request" });
  });
  it.each(["register_total_invalid", "business_date_invalid"])(
    "P0001 %s is a 422 with an Italian text",
    (code) => {
      const mapped = map("P0001", code) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([422, code]);
      expect(mapped.message).not.toContain(code);
    },
  );
  it("an unknown error is a plain Error naming only the SQLSTATE", () => {
    const mapped = map("P0001", "something_else");
    expect(mapped).not.toBeInstanceOf(ApiError);
    expect(mapped.message).toBe("Unexpected database error P0001");
  });
});
