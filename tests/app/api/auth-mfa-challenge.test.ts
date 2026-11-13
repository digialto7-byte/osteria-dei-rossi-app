import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { challengeOutput } from "@/server/auth/mfa-schemas";

// P2-1 A10 (docs/plans/2026-11-12-p2-1-totp.md section 3.4, 3.14): the sign-in challenge. The person has signed in at aal1 and types the code from the
// authenticator. Same order as the enrolment verify (attempt check, one challengeAndVerify, failure record), stage login, and no success row.
let client: FakeSupabase;
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => report);

const challenge = await import("@/app/api/auth/mfa/challenge/route");

const SECRET = "JBSWY3DPEHPK3PXP";
const CODE = "123456";
const F1 = "f0000000-0000-4000-8000-000000000001";
type Script = Record<string, { data: unknown; error: { code?: string; message: string } | null }[]>;
const ok = (data: unknown = null) => [{ data, error: null }];
const fail = (code: string, message = "x") => [{ data: null, error: { code, message } }];
const FULL: Script = {
  mfa_attempt_allowed: ok({ allowed: true, retryAfterSeconds: 0 }),
  mfa_record_failure: ok(),
};
const make = (
  script: Script = FULL,
  claims: FakeClaims | null = { ...claimsFor("owner"), aal: "aal1" },
) => {
  client = fakeSupabase({ claims, rpc: script });
};
const authReply = (data: unknown, error: unknown = null) => ({ data, error });
const authError = (status: number, code: string, message = "x") => ({
  name: "AuthApiError",
  status,
  code,
  message,
});
const names = () => client.rpc.mock.calls.map((c) => c[0]);
const send = (body: unknown) =>
  challenge.POST(jsonRequest("http://localhost:3000/api/auth/mfa/challenge", body));
const good = () =>
  authReply({
    access_token: "t",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "r",
    user: {},
  });
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  report.reportError.mockReset();
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const s of consoleSpies.splice(0)) s.mockRestore();
});

describe("POST /api/auth/mfa/challenge", () => {
  it("success: one challengeAndVerify, no success record, and the redirect is the safe next path", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    const response = await send({ factorId: F1, code: CODE, next: "/oggi" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(challengeOutput.parse(body)).toEqual(body);
    expect(body).toEqual({ redirect: "/oggi" });
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledTimes(1);
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: F1, code: CODE });
    expect("challenge" in client.auth.mfa).toBe(false);
    expect(names()).toEqual(["mfa_attempt_allowed"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("an external next becomes the landing page: no open redirect", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    for (const next of [
      "https://evil.example/x",
      "//evil.example",
      "javascript:alert(1)",
      "/\\evil.example",
    ]) {
      const body = await (await send({ factorId: F1, code: CODE, next })).json();
      expect(body.redirect).toBe("/");
    }
  });

  it("an admin and a missing next also land on the role's landing page", async () => {
    make(FULL, { ...claimsFor("admin"), aal: "aal1" });
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    expect((await (await send({ factorId: F1, code: CODE })).json()).redirect).toBe("/");
  });

  it("is exempt from the gate: an aal1 owner needs no mfa_gate call to reach it", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    await send({ factorId: F1, code: CODE });
    expect(names()).not.toContain("mfa_gate");
  });

  it("a malformed body is 400 with no RPC and no Auth call", async () => {
    make();
    for (const body of [
      { factorId: F1, code: "12345" },
      { factorId: "x", code: CODE },
      { code: CODE },
      { factorId: F1, code: CODE, extra: 1 },
      { factorId: F1, code: CODE, next: "x".repeat(513) },
    ]) {
      expect((await send(body)).status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a locked account is 429 mfa_locked with retryAfterSeconds and makes no Auth call", async () => {
    make({ ...FULL, mfa_attempt_allowed: ok({ allowed: false, retryAfterSeconds: 880 }) });
    const response = await send({ factorId: F1, code: CODE });
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("mfa_locked");
    expect(body.error.details).toEqual({ retryAfterSeconds: 880 });
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a wrong code records a failure at stage login, then 422 mfa_code_invalid (never 401)", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(400, "mfa_verification_failed", `Invalid TOTP code ${CODE}`)),
    );
    const response = await send({ factorId: F1, code: CODE });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("mfa_code_invalid");
    expect(client.rpc).toHaveBeenCalledWith("mfa_record_failure", { p_stage: "login" });
    expect(names()).toEqual(["mfa_attempt_allowed", "mfa_record_failure"]);
  });

  it("an expired challenge is 422 and not counted; a Supabase 429 is 429 rate_limited; an unknown factor is 404; the rest is 502", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(422, "mfa_challenge_expired")),
    );
    expect((await (await send({ factorId: F1, code: CODE })).json()).error.code).toBe(
      "mfa_challenge_expired",
    );
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(429, "over_request_rate_limit")),
    );
    const limited = await send({ factorId: F1, code: CODE });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("rate_limited");
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(404, "mfa_factor_not_found")),
    );
    expect((await send({ factorId: F1, code: CODE })).status).toBe(404);
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(500, "unexpected_failure")),
    );
    expect((await send({ factorId: F1, code: CODE })).status).toBe(502);
    expect(names().filter((n) => n === "mfa_record_failure")).toHaveLength(0);
  });

  it("chef and waiter get 403 before anything is called; no session is 401", async () => {
    for (const role of ["chef", "waiter"]) {
      make(FULL, { ...claimsFor(role), aal: "aal1" });
      expect((await send({ factorId: F1, code: CODE })).status).toBe(403);
      expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    }
    make(FULL, null);
    expect((await send({ factorId: F1, code: CODE })).status).toBe(401);
  });

  it("an attempt-check failure is a 500 and no Auth call is made", async () => {
    make({ ...FULL, mfa_attempt_allowed: fail("XX000", "boom") });
    expect((await send({ factorId: F1, code: CODE })).status).toBe(500);
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("no failure path returns or logs the code or a secret", async () => {
    make({ ...FULL, mfa_record_failure: fail("XX000", `detail ${CODE} ${SECRET}`) });
    const poisoned = authReply(
      null,
      authError(400, "mfa_verification_failed", `Invalid ${CODE} ${SECRET}`),
    );
    client.auth.mfa.challengeAndVerify.mockResolvedValue(poisoned);
    const text = await (await send({ factorId: F1, code: CODE })).text();
    const logged = JSON.stringify([
      report.reportError.mock.calls,
      consoleSpies.flatMap((s) => s.mock.calls),
    ]);
    expect(text + logged).not.toContain(CODE);
    expect(text + logged).not.toContain(SECRET);
  });
});
