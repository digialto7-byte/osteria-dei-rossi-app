import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeClaims,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import {
  PLATFORM_ROUTE_ERRORS,
  accountMfaCodeRequestSchema,
  accountMfaCodeResponseSchema,
  accountMfaEnrolResponseSchema,
  accountMfaGetResponseSchema,
  accountMfaVerifyResponseSchema,
} from "@/lib/platform/api";

// SP3 step 9 (plan 3.4.3, 3.6): the account-level second factor of platform staff, who have no venue membership. Both hosts; access `authenticated` (no tenant claim
// needed); the lock and the audit are the platform_mfa_* procedures. The setup key and the code are fakes and appear only in the one enrolment reply.
let client: FakeSupabase;
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => report);

const account = await import("@/app/api/auth/mfa/account/route");
const enrol = await import("@/app/api/auth/mfa/account/factors/route");
const verify = await import("@/app/api/auth/mfa/account/factors/[id]/verify/route");

const STAFF = "a6000000-0000-4000-8000-000000000001";
const SECRET = "JBSWY3DPEHPK3PXP";
const CODE = "123456";
const F1 = "f0000000-0000-4000-8000-000000000001";
const F2 = "f0000000-0000-4000-8000-000000000002";
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/></svg>';
const NOW = Date.parse("2025-03-20T10:00:00Z");

type Script = Record<string, { data: unknown; error: { code?: string; message: string } | null }[]>;
const ok = (data: unknown = null) => [{ data, error: null }];
const fail = (code: string, message = "x") => [{ data: null, error: { code, message } }];
const FULL: Script = {
  platform_mfa_attempt_allowed: ok({ allowed: true, retryAfterSeconds: 0 }),
  platform_mfa_record_failure: ok(),
  platform_mfa_record_enrolled: ok(true),
  mfa_enrol_check: ok({ issuer: "Costì", friendlyName: "Principale" }),
};
/** A platform staff token: a session with no tenant claim, at aal1 unless said otherwise. */
const STAFF_CLAIMS: FakeClaims = { sub: STAFF, aal: "aal1" };
const make = (script: Script = FULL, claims: FakeClaims | null = STAFF_CLAIMS) => {
  client = fakeSupabase({ claims, rpc: script });
};
const authReply = (data: unknown, error: unknown = null) => ({ data, error });
const authError = (status: number, code: string, message = "x") => ({
  name: "AuthApiError",
  status,
  code,
  message,
});
const factor = (id: string, name: string, state: "verified" | "unverified") => ({
  id,
  friendly_name: name,
  factor_type: "totp",
  status: state,
  created_at: "2025-03-12T09:30:00.000Z",
  updated_at: "2025-03-12T09:30:00.000Z",
});
const names = () => client.rpc.mock.calls.map((c) => c[0]);
const post = (path: string, body: unknown) => jsonRequest(`http://127.0.0.1:3000${path}`, body);
const get = (path: string) => new Request(`http://127.0.0.1:3000${path}`);
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
const loggedText = () =>
  JSON.stringify([report.reportError.mock.calls, consoleSpies.flatMap((s) => s.mock.calls)]);
/** The venue's own MFA procedures: the account routes must never call them (they need a membership). */
const VENUE_RPCS = [
  "mfa_attempt_allowed",
  "mfa_record_failure",
  "mfa_record_enrolled",
  "mfa_status",
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  report.reportError.mockReset();
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  }
});
afterEach(() => {
  vi.useRealTimers();
  for (const s of consoleSpies.splice(0)) s.mockRestore();
});

describe("GET /api/auth/mfa/account", () => {
  const withFactors = (all: unknown[], level: string, script: Script = FULL) => {
    make(script);
    client.auth.mfa.listFactors.mockResolvedValue(authReply({ all, totp: [] }));
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(
      authReply({ currentLevel: level, nextLevel: "aal2", currentAuthenticationMethods: [] }),
    );
  };

  it("answers the exact shape for staff with no tenant claim: factors with slots, the level, canAddFactor, no lock", async () => {
    withFactors(
      [factor(F1, "Principale", "verified"), factor(F2, "Riserva", "unverified")],
      "aal1",
    );
    const response = await account.GET(get("/api/auth/mfa/account"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(accountMfaGetResponseSchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      factors: [
        { id: F1, slot: "principale", status: "verified" },
        { id: F2, slot: "riserva", status: "unverified" },
      ],
      currentLevel: "aal1",
      canAddFactor: false,
      lockedUntil: null,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(names()).toEqual(["platform_mfa_attempt_allowed"]);
  });

  it("a staff member with no factor can add one at aal1; with one factor at aal2 too, and not at aal1", async () => {
    withFactors([], "aal1");
    expect((await (await account.GET(get("/api/auth/mfa/account"))).json()).canAddFactor).toBe(
      true,
    );
    withFactors([factor(F1, "Principale", "verified")], "aal2");
    expect((await (await account.GET(get("/api/auth/mfa/account"))).json()).canAddFactor).toBe(
      true,
    );
    withFactors([factor(F1, "Principale", "verified")], "aal1");
    expect((await (await account.GET(get("/api/auth/mfa/account"))).json()).canAddFactor).toBe(
      false,
    );
    withFactors([factor(F1, "Principale", "verified"), factor(F2, "Riserva", "verified")], "aal2");
    expect((await (await account.GET(get("/api/auth/mfa/account"))).json()).canAddFactor).toBe(
      false,
    );
  });

  it("a locked account shows lockedUntil, computed from Postgres's retry time", async () => {
    withFactors([], "aal1", {
      ...FULL,
      platform_mfa_attempt_allowed: ok({ allowed: false, retryAfterSeconds: 600 }),
    });
    const body = await (await account.GET(get("/api/auth/mfa/account"))).json();
    expect(body.lockedUntil).toBe(new Date(NOW + 600_000).toISOString());
  });

  it("an account that is not active platform staff is 403 forbidden before any Auth call", async () => {
    make({ ...FULL, platform_mfa_attempt_allowed: fail("42501", "insufficient_privilege") });
    const response = await account.GET(get("/api/auth/mfa/account"));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(client.auth.mfa.listFactors).not.toHaveBeenCalled();
  });

  it("no session is 401, and the venue's own procedures are never called", async () => {
    make(FULL, null);
    expect((await account.GET(get("/api/auth/mfa/account"))).status).toBe(401);
    make();
    await account.GET(get("/api/auth/mfa/account"));
    for (const name of VENUE_RPCS) expect(names()).not.toContain(name);
  });
});

describe("POST /api/auth/mfa/account (the sign-in code)", () => {
  const send = (body: unknown) => account.POST(post("/api/auth/mfa/account", body));
  const good = () =>
    authReply({
      access_token: "t",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "r",
      user: {},
    });

  it("success: the lock is checked, one challengeAndVerify, no success record, the redirect is the safe next path", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    const response = await send({ factorId: F1, code: CODE, next: "/locali" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(accountMfaCodeResponseSchema.parse(body)).toEqual(body);
    expect(body).toEqual({ redirect: "/locali" });
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledTimes(1);
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: F1, code: CODE });
    expect(names()).toEqual(["platform_mfa_attempt_allowed"]);
    expect(client.rpc.mock.invocationCallOrder[0]!).toBeLessThan(
      client.auth.mfa.challengeAndVerify.mock.invocationCallOrder[0]!,
    );
  });

  it("without next the redirect is /, and an external next becomes / too (no open redirect)", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    expect((await (await send({ factorId: F1, code: CODE })).json()).redirect).toBe("/");
    for (const next of [
      "https://evil.example/x",
      "//evil.example",
      "javascript:alert(1)",
      "/\\evil.example",
    ])
      expect((await (await send({ factorId: F1, code: CODE, next })).json()).redirect).toBe("/");
  });

  it("is not gated: it works with no tenant claim and at aal1 (no mfa_gate call)", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    expect((await send({ factorId: F1, code: CODE })).status).toBe(200);
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
      expect(accountMfaCodeRequestSchema.safeParse(body).success).toBe(false);
      expect((await send(body)).status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a locked account is 429 mfa_locked with retryAfterSeconds and makes no Auth call", async () => {
    make({ ...FULL, platform_mfa_attempt_allowed: ok({ allowed: false, retryAfterSeconds: 880 }) });
    const response = await send({ factorId: F1, code: CODE });
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("mfa_locked");
    expect(body.error.details).toEqual({ retryAfterSeconds: 880 });
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a wrong code records a failure at stage login in the platform table, then 422 mfa_code_invalid (never 401)", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(400, "mfa_verification_failed", `Invalid TOTP code ${CODE}`)),
    );
    const response = await send({ factorId: F1, code: CODE });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("mfa_code_invalid");
    expect(client.rpc).toHaveBeenCalledWith("platform_mfa_record_failure", { p_stage: "login" });
    expect(names()).toEqual(["platform_mfa_attempt_allowed", "platform_mfa_record_failure"]);
  });

  it("an expired challenge is 422 and not counted; Supabase's 429 is 429 rate_limited; an unknown factor is 404; the rest is 502", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(422, "mfa_challenge_expired")),
    );
    const expired = await send({ factorId: F1, code: CODE });
    expect(expired.status).toBe(422);
    expect((await expired.json()).error.code).toBe("mfa_challenge_expired");
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(429, "over_request_rate_limit")),
    );
    const limited = await send({ factorId: F1, code: CODE });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("rate_limited");
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(404, "mfa_factor_not_found")),
    );
    const missing = await send({ factorId: F1, code: CODE });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(500, "unexpected_failure")),
    );
    const broken = await send({ factorId: F1, code: CODE });
    expect(broken.status).toBe(502);
    expect((await broken.json()).error.code).toBe("upstream_error");
    expect(names().filter((n) => n === "platform_mfa_record_failure")).toHaveLength(0);
  });

  it("an account that is not active platform staff is 403 forbidden and makes no Auth call", async () => {
    make({ ...FULL, platform_mfa_attempt_allowed: fail("42501", "insufficient_privilege") });
    const response = await send({ factorId: F1, code: CODE });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("no session is 401; a non-JSON write is 415", async () => {
    make(FULL, null);
    expect((await send({ factorId: F1, code: CODE })).status).toBe(401);
    make();
    const text = await account.POST(
      new Request("http://127.0.0.1:3000/api/auth/mfa/account", { method: "POST", body: "x" }),
    );
    expect(text.status).toBe(415);
  });

  it("no failure path returns or logs the code or a secret", async () => {
    make({ ...FULL, platform_mfa_record_failure: fail("XX000", `detail ${CODE} ${SECRET}`) });
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(400, "mfa_verification_failed", `Invalid ${CODE} ${SECRET}`)),
    );
    const text = await (await send({ factorId: F1, code: CODE })).text();
    expect(text + loggedText()).not.toContain(CODE);
    expect(text + loggedText()).not.toContain(SECRET);
  });
});

describe("POST /api/auth/mfa/account/factors (start the enrolment)", () => {
  const start = (slot: unknown = "principale") =>
    enrol.POST(post("/api/auth/mfa/account/factors", { slot }));
  const enrolled = (svg = SVG) =>
    authReply({
      id: F1,
      type: "totp",
      friendly_name: "Principale",
      totp: { qr_code: svg, secret: SECRET, uri: `otpauth://totp/x?secret=${SECRET}` },
    });

  it("checks in Postgres (issuer Costì), clears own unverified factors, enrols with the check's values; 200 with the image and the key", async () => {
    make();
    client.auth.mfa.listFactors.mockResolvedValue(
      authReply({
        all: [
          factor(F2, "Principale", "unverified"),
          factor("f0000000-0000-4000-8000-000000000009", "Riserva", "verified"),
        ],
        totp: [],
      }),
    );
    client.auth.mfa.unenroll.mockResolvedValue(authReply({ id: F2 }));
    client.auth.mfa.enroll.mockResolvedValue(enrolled());
    const response = await start();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(accountMfaEnrolResponseSchema.parse(body)).toEqual(body);
    expect(body.factorId).toBe(F1);
    expect(body.slot).toBe("principale");
    expect(body.secret).toBe(SECRET);
    expect(body.qrImage.startsWith("data:image/svg+xml;utf-8,%3Csvg")).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("mfa_enrol_check", { p_slot: "principale" });
    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: F2 });
    expect(client.auth.mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Principale",
      issuer: "Costì",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("the setup key and the QR image are in this reply only: not logged, reported or put in an error", async () => {
    make();
    client.auth.mfa.enroll.mockResolvedValue(enrolled());
    await start();
    expect(loggedText()).not.toContain(SECRET);
    make({ ...FULL, mfa_enrol_check: fail("XX000", `boom ${SECRET}`) });
    const text = await (await start()).text();
    expect(text + loggedText()).not.toContain(SECRET);
  });

  it("the slot riserva is accepted; any other slot or key is 400 with no RPC", async () => {
    make({ ...FULL, mfa_enrol_check: ok({ issuer: "Costì", friendlyName: "Riserva" }) });
    client.auth.mfa.enroll.mockResolvedValue(enrolled());
    expect((await start("riserva")).status).toBe(200);
    make();
    for (const body of [{ slot: "altro" }, {}, { slot: "principale", extra: 1 }]) {
      expect((await enrol.POST(post("/api/auth/mfa/account/factors", body))).status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["mfa_required", 403, "mfa_required"],
    ["mfa_slot_taken", 409, "mfa_slot_taken"],
    ["mfa_factor_limit", 409, "mfa_factor_limit"],
  ])("Postgres' %s is %i %s", async (message, status, code) => {
    make({ ...FULL, mfa_enrol_check: fail("P0001", message) });
    const response = await start();
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it("an account that is not active platform staff is 403 forbidden and enrols nothing", async () => {
    make({ ...FULL, mfa_enrol_check: fail("42501", "insufficient_privilege") });
    const response = await start();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it("Supabase's 429 is 429 rate_limited, any other Auth failure is 502, and an SVG with a script is 502 with nothing returned", async () => {
    make();
    client.auth.mfa.enroll.mockResolvedValue(
      authReply(null, authError(429, "over_request_rate_limit")),
    );
    expect((await start()).status).toBe(429);
    client.auth.mfa.enroll.mockResolvedValue(authReply(null, authError(500, "unexpected_failure")));
    expect((await start()).status).toBe(502);
    client.auth.mfa.enroll.mockResolvedValue(enrolled("<svg><script>alert(1)</script></svg>"));
    client.auth.mfa.unenroll.mockResolvedValue(authReply({ id: F1 }));
    const bad = await start();
    expect(bad.status).toBe(502);
    expect(await bad.text()).not.toContain(SECRET);
  });

  it("no session is 401", async () => {
    make(FULL, null);
    expect((await start()).status).toBe(401);
  });
});

describe("POST /api/auth/mfa/account/factors/[id]/verify", () => {
  const send = (id: string, body: unknown) =>
    verify.POST(post(`/api/auth/mfa/account/factors/${id}/verify`, body), routeContext({ id }));
  const good = () =>
    authReply({
      access_token: "t",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "r",
      user: {},
    });
  const listVerified = () =>
    client.auth.mfa.listFactors.mockResolvedValue(
      authReply({ all: [factor(F1, "Principale", "verified")], totp: [] }),
    );

  it("checks the lock, one challengeAndVerify, records the enrolment in the platform audit; answers the verified factor at aal2", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    listVerified();
    const response = await send(F1, { code: CODE });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(accountMfaVerifyResponseSchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      factor: {
        id: F1,
        slot: "principale",
        status: "verified",
        createdAt: "2025-03-12T09:30:00.000Z",
      },
      currentLevel: "aal2",
    });
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledTimes(1);
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: F1, code: CODE });
    expect(names()).toEqual(["platform_mfa_attempt_allowed", "platform_mfa_record_enrolled"]);
    expect(client.rpc).toHaveBeenCalledWith("platform_mfa_record_enrolled", { p_factor: F1 });
    for (const name of VENUE_RPCS) expect(names()).not.toContain(name);
  });

  it("a malformed id or body is 404 or 400 with no RPC and no Auth call", async () => {
    make();
    expect((await send("not-a-uuid", { code: CODE })).status).toBe(404);
    for (const body of [{ code: "12345" }, {}, { code: CODE, extra: 1 }])
      expect((await send(F1, body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a locked account is 429 mfa_locked and makes no Auth call", async () => {
    make({ ...FULL, platform_mfa_attempt_allowed: ok({ allowed: false, retryAfterSeconds: 120 }) });
    const response = await send(F1, { code: CODE });
    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatchObject({
      code: "mfa_locked",
      details: { retryAfterSeconds: 120 },
    });
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a wrong code records a failure at stage enrol, then 422 mfa_code_invalid; nothing is recorded as enrolled", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(400, "mfa_verification_failed", `Invalid ${CODE}`)),
    );
    const response = await send(F1, { code: CODE });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("mfa_code_invalid");
    expect(names()).toEqual(["platform_mfa_attempt_allowed", "platform_mfa_record_failure"]);
    expect(client.rpc).toHaveBeenCalledWith("platform_mfa_record_failure", { p_stage: "enrol" });
  });

  it("an expired challenge is 422, an unknown factor 404, Supabase's 429 is 429 rate_limited, the rest 502", async () => {
    make();
    for (const [error, status, code] of [
      [authError(422, "mfa_challenge_expired"), 422, "mfa_challenge_expired"],
      [authError(404, "mfa_factor_not_found"), 404, "not_found"],
      [authError(429, "over_request_rate_limit"), 429, "rate_limited"],
      [authError(500, "unexpected_failure"), 502, "upstream_error"],
    ] as const) {
      client.auth.mfa.challengeAndVerify.mockResolvedValue(authReply(null, error));
      const response = await send(F1, { code: CODE });
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
  });

  it("an account that is not active platform staff is 403 forbidden and makes no Auth call", async () => {
    make({ ...FULL, platform_mfa_attempt_allowed: fail("42501", "insufficient_privilege") });
    const response = await send(F1, { code: CODE });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a failing audit record does not hide the outcome: the factor is verified, the failure is reported by code only", async () => {
    make({ ...FULL, platform_mfa_record_enrolled: fail("XX000", `boom ${SECRET}`) });
    client.auth.mfa.challengeAndVerify.mockResolvedValue(good());
    listVerified();
    expect((await send(F1, { code: CODE })).status).toBe(200);
    expect(report.reportError).toHaveBeenCalled();
    expect(loggedText()).not.toContain(SECRET);
    expect(loggedText()).not.toContain(CODE);
  });

  it("no session is 401", async () => {
    make(FULL, null);
    expect((await send(F1, { code: CODE })).status).toBe(401);
  });
});

describe("the account routes' contract", () => {
  it("every error code a route lists in the API contract is one these tests exercise (the list is not stale)", () => {
    expect(
      Object.keys(PLATFORM_ROUTE_ERRORS).filter((r) => r.includes("/api/auth/mfa/account")),
    ).toEqual([
      "GET /api/auth/mfa/account",
      "POST /api/auth/mfa/account",
      "POST /api/auth/mfa/account/factors",
      "POST /api/auth/mfa/account/factors/[id]/verify",
    ]);
  });

  it("no answer holds a cost-like key or an @ (replies carry ids, slots, levels and the one-time key only)", async () => {
    make();
    client.auth.mfa.listFactors.mockResolvedValue(
      authReply({ all: [factor(F1, "Principale", "verified")], totp: [] }),
    );
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(
      authReply({ currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [] }),
    );
    const text = await (await account.GET(get("/api/auth/mfa/account"))).text();
    expect(text).not.toMatch(/cost|margin|price|vat|email|@/i);
  });

  it("a tenant token (an owner with a tenant claim) is not special: the platform procedures decide, and a non-staff owner gets 403", async () => {
    make(
      { ...FULL, platform_mfa_attempt_allowed: fail("42501", "insufficient_privilege") },
      { ...claimsFor("owner"), aal: "aal2" },
    );
    expect((await account.GET(get("/api/auth/mfa/account"))).status).toBe(403);
  });
});
