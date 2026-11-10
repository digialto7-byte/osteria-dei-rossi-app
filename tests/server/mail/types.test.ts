import { describe, expect, it } from "vitest";
import { kindForStatus } from "@/server/mail/types";

describe("kindForStatus", () => {
  // 408 is a timeout; 409 is Resend's concurrent_idempotent_requests (the same Idempotency-Key is still in flight): both clear on their own.
  it.each([408, 409, 429, 500, 502, 503, 504, 599])("%i is retry", (status) => {
    expect(kindForStatus(status)).toBe("retry");
  });

  it.each([400, 401, 403, 404, 410, 422, 407, 418])("%i is rejected", (status) => {
    expect(kindForStatus(status)).toBe("rejected");
  });
});
