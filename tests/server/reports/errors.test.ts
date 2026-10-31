import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapReportDbError } from "@/server/reports/errors";

const map = (code: string, message: string) => mapReportDbError({ code, message });

describe("mapReportDbError", () => {
  it("42501 is a 403 with the reserved text", () => {
    expect(map("42501", "x")).toMatchObject({
      status: 403,
      code: "forbidden",
      message: "I report sono riservati al titolare e all'amministratore.",
    });
  });
  it("22023 is a 400", () => {
    expect(map("22023", "invalid_request")).toMatchObject({ status: 400, code: "invalid_request" });
  });
  it.each([
    "range_invalid",
    "range_too_long",
    "date_in_future",
    "avt_count_not_monthly",
    "avt_count_not_closed",
    "avt_no_opening_count",
  ])("P0001 %s is a 422 with an Italian text", (code) => {
    const mapped = map("P0001", code) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([422, code]);
    expect(mapped.message).not.toContain(code);
    expect(mapped.message.length).toBeGreaterThan(10);
  });
  it("P0002 count_not_found is a 404", () => {
    expect(map("P0002", "count_not_found")).toMatchObject({ status: 404, code: "not_found" });
  });
  it("a P0002 about anything else is not mapped", () => {
    expect(map("P0002", "tenant_not_found")).not.toBeInstanceOf(ApiError);
  });
  it("an unknown error is a plain Error naming only the SQLSTATE", () => {
    const mapped = map("P0001", "something_else");
    expect(mapped).not.toBeInstanceOf(ApiError);
    expect(mapped.message).toBe("Unexpected database error P0001");
  });
  it("never sends the database message", () => {
    const mapped = map("P0001", "range_too_long") as ApiError;
    expect(mapped.message).not.toMatch(/range_too_long|P0001/);
  });
});
