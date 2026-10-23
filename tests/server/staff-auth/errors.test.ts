import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { messages } from "@/lib/i18n";
import {
  mapStaffAuthDbError,
  pinTrivialError,
  mapStaffAuthStatus,
  STAFF_AUTH_STATUSES,
} from "@/server/staff-auth/errors";

// M11 plan §3.3: every RPC status and error code maps to its HTTP status and an Italian text.
describe("mapStaffAuthStatus (the statuses the login and enrolment procedures return)", () => {
  it.each([
    ["device_missing", 401, "device_missing"],
    ["device_unknown", 401, "device_unknown"],
    ["device_revoked", 401, "device_revoked"],
    ["device_locked", 423, "device_locked"],
    ["user_locked", 423, "user_locked"],
    ["pin_invalid", 401, "pin_invalid"],
    ["attempt_in_progress", 429, "attempt_in_progress"],
    ["auth_rate_limited", 429, "auth_rate_limited"],
    ["upstream_error", 502, "upstream_error"],
    ["session_ended", 401, "session_ended"],
    ["code_invalid", 404, "enrolment_code_invalid"],
    ["code_used", 410, "enrolment_code_used"],
    ["code_expired", 410, "enrolment_code_expired"],
    ["rate_limited", 429, "enrol_rate_limited"],
  ] as const)("%s -> %i %s with an Italian text", (status, http, code) => {
    const error = mapStaffAuthStatus(status);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(http);
    expect(error.code).toBe(code);
    expect(error.message).toBe(messages.it[`staffAuthError.${code}` as keyof typeof messages.it]);
    expect(error.message.trim()).not.toBe("");
  });

  it("lists exactly the statuses it maps", () => {
    expect([...STAFF_AUTH_STATUSES].sort()).toEqual(
      [
        "attempt_in_progress",
        "auth_rate_limited",
        "code_expired",
        "code_invalid",
        "code_used",
        "device_locked",
        "device_missing",
        "device_revoked",
        "device_unknown",
        "pin_invalid",
        "rate_limited",
        "session_ended",
        "upstream_error",
        "user_locked",
      ].sort(),
    );
  });

  it("pin_invalid carries attemptsLeft and user_locked carries lockedUntil, as details", () => {
    expect(mapStaffAuthStatus("pin_invalid", { attemptsLeft: 2 }).details).toEqual([
      { attemptsLeft: 2 },
    ]);
    expect(
      mapStaffAuthStatus("user_locked", { lockedUntil: "2026-10-24T19:15:00Z" }).details,
    ).toEqual([{ lockedUntil: "2026-10-24T19:15:00Z" }]);
    expect(mapStaffAuthStatus("pin_invalid").details).toBeUndefined();
    expect(mapStaffAuthStatus("device_locked", { attemptsLeft: 1 }).details).toBeUndefined();
  });

  it("an unknown status is an error that names no value", () => {
    expect(() => mapStaffAuthStatus("surprise" as never)).toThrow(/status/);
  });

  it("has an English text for every code", () => {
    for (const status of STAFF_AUTH_STATUSES) {
      const error = mapStaffAuthStatus(status);
      const key = `staffAuthError.${error.code}` as keyof typeof messages.en;
      expect(messages.en[key]).toBeTruthy();
      expect(messages.en[key]).not.toBe(messages.it[key]);
    }
  });
});

describe("mapStaffAuthDbError (the SQL errors of the management procedures)", () => {
  const db = (code: string, message = "x") => mapStaffAuthDbError({ code, message });

  it.each([
    ["42501", "", 403, "forbidden"],
    ["P0002", "staff_not_found", 404, "not_found"],
    ["P0002", "device_not_found", 404, "not_found"],
    ["P0001", "label_invalid", 422, "label_invalid"],
    ["P0001", "display_name_invalid", 422, "display_name_invalid"],
    ["P0001", "staff_role_invalid", 422, "staff_role_invalid"],
    ["P0001", "nothing_to_change", 422, "nothing_to_change"],
    ["P0001", "staff_inactive", 409, "staff_inactive"],
    ["P0001", "staff_not_pin", 409, "staff_not_pin"],
    ["P0001", "device_revoked", 409, "device_revoked"],
    ["P0001", "auth_user_invalid", 409, "auth_user_invalid"],
  ] as const)("%s %s -> %i %s", (sqlstate, message, http, code) => {
    const error = db(sqlstate, message);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(http);
    expect((error as ApiError).code).toBe(code);
    expect(error.message.trim()).not.toBe("");
  });

  it("never sends the database message", () => {
    const error = db("P0001", "label_invalid") as ApiError;
    expect(error.message).not.toContain("label_invalid");
  });

  it("an unknown SQLSTATE is a plain error with the SQLSTATE only, no message", () => {
    const error = db("XX000", "secret detail 4827");
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.message).toBe("Unexpected database error XX000");
    expect(error.message).not.toContain("4827");
  });

  it("an unknown P0001 code is a plain error too", () => {
    const error = db("P0001", "attempt_not_pending");
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.message).toBe("Unexpected database error P0001");
  });

  it("a missing SQLSTATE is reported as such", () => {
    expect(mapStaffAuthDbError({ message: "boom" }).message).toBe(
      "Unexpected database error (no code)",
    );
  });
});

describe("pinTrivialError", () => {
  it("is a 422 pin_trivial with the Italian text", () => {
    const error = pinTrivialError();
    expect(error.status).toBe(422);
    expect(error.code).toBe("pin_trivial");
    expect(error.message).toBe(messages.it["staffAuthError.pin_trivial"]);
  });
});
