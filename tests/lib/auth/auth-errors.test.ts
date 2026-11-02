import { describe, expect, it } from "vitest";
import { classifySignIn, classifyUpdate, classifyVerify, toLogSafe } from "@/lib/auth/auth-errors";

describe("classifySignIn", () => {
  it("reads Auth's answers", () => {
    expect(classifySignIn({ status: 400, code: "invalid_credentials" })).toBe("invalid");
    expect(classifySignIn({ status: 429, code: "over_request_rate_limit" })).toBe("rate_limited");
    expect(classifySignIn({ status: 500, code: "unexpected_failure" })).toBe("upstream");
  });
  it("treats a fetch error, a timeout and anything unknown as upstream", () => {
    expect(classifySignIn({ status: 0, name: "AuthRetryableFetchError" })).toBe("upstream");
    expect(classifySignIn(new Error("timeout"))).toBe("upstream");
    expect(classifySignIn({ status: 400, code: "something_else" })).toBe("upstream");
    expect(classifySignIn(null)).toBe("upstream");
    expect(classifySignIn("boom")).toBe("upstream");
  });
});

describe("classifyVerify", () => {
  it("maps an expired or invalid code", () => {
    expect(classifyVerify({ status: 403, code: "otp_expired" })).toBe("code_invalid");
    expect(classifyVerify({ status: 400, code: "validation_failed" })).toBe("code_invalid");
  });
  it("maps the limit and the rest", () => {
    expect(classifyVerify({ status: 429, code: "over_request_rate_limit" })).toBe("rate_limited");
    expect(classifyVerify({ status: 502 })).toBe("upstream");
    expect(classifyVerify(new TypeError("fetch failed"))).toBe("upstream");
  });
});

describe("classifyUpdate", () => {
  it("maps a weak or unchanged password", () => {
    expect(classifyUpdate({ status: 422, code: "weak_password" })).toBe("weak");
    expect(classifyUpdate({ status: 422, code: "same_password" })).toBe("same");
  });
  it("maps the limit and the rest", () => {
    expect(classifyUpdate({ status: 429 })).toBe("rate_limited");
    expect(classifyUpdate({ status: 500 })).toBe("upstream");
    expect(classifyUpdate({ status: 422, code: "other" })).toBe("upstream");
  });
});

describe("toLogSafe", () => {
  it("keeps the status and the code only", () => {
    const error = {
      status: 400,
      code: "invalid_credentials",
      message: "Invalid login for titolare.demo@example.test",
      name: "AuthApiError",
    };
    const safe = toLogSafe(error);
    expect(safe).toEqual({ status: 400, code: "invalid_credentials" });
    expect(JSON.stringify(safe)).not.toContain("example.test");
  });
  it("copes with an error that has neither", () => {
    expect(toLogSafe(new Error("x@example.test"))).toEqual({});
    expect(toLogSafe(null)).toEqual({});
  });
});
