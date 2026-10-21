import { describe, expect, it } from "vitest";
import { classifyOtpError } from "@/lib/auth/otp-error";

describe("classifyOtpError", () => {
  it("no error is sent", () => {
    expect(classifyOtpError(null)).toBe("sent");
  });

  it.each(["otp_disabled", "signup_disabled", "user_not_found"])(
    "%s means the address has no account (answered like a success)",
    (code) => {
      expect(classifyOtpError({ status: 422, code })).toBe("unknown_address");
    },
  );

  it("429 is rate_limited", () => {
    expect(classifyOtpError({ status: 429, code: "over_email_send_rate_limit" })).toBe(
      "rate_limited",
    );
  });

  it("5xx or a missing status is an upstream failure", () => {
    expect(classifyOtpError({ status: 500, code: "unexpected_failure" })).toBe("upstream");
    expect(classifyOtpError({ code: "x" })).toBe("upstream");
  });

  it("any other rejection is unexpected and must be logged", () => {
    expect(classifyOtpError({ status: 422, code: "email_provider_disabled" })).toBe("unexpected");
    expect(classifyOtpError({ status: 400 })).toBe("unexpected");
  });
});
