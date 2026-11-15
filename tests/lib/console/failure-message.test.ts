import { describe, expect, it } from "vitest";
import type { ConsoleFailure } from "@/lib/console/console-api";
import { failureMessage } from "@/lib/console/failure-message";

const failure = (status: number, code: string, message = "dal server"): ConsoleFailure => ({
  ok: false,
  status,
  error: { code, message },
  leaving: false,
});

describe("failureMessage", () => {
  it("says the console does not answer for a network failure, a 5xx and an unreadable reply", () => {
    for (const f of [
      failure(0, "network"),
      failure(500, "internal"),
      failure(502, "upstream_error"),
      failure(503, "console_switch_failed"),
      failure(200, "bad_response"),
    ])
      expect(failureMessage(f, "console.locali.readError")).toBe(
        "La console non risponde. Riprova tra poco.",
      );
  });

  it("says the same when the switch into console mode did not bring console mode", () => {
    expect(failureMessage(failure(409, "console_unavailable"), "console.locali.readError")).toBe(
      "La console non risponde. Riprova tra poco.",
    );
  });

  it("says the account has no access for 403 forbidden", () => {
    expect(failureMessage(failure(403, "forbidden"), "console.locali.readError")).toBe(
      "Questo account non ha accesso alla console.",
    );
  });

  it("names the read that failed for anything else, never the server's text", () => {
    expect(failureMessage(failure(400, "invalid_request"), "console.locali.readError")).toBe(
      "Non riesco a leggere i locali.",
    );
    expect(failureMessage(failure(404, "x"), "console.audit.readError")).toBe(
      "Non riesco a leggere il registro.",
    );
  });
});
