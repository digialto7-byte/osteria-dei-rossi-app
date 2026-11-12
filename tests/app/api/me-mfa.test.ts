import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { OFFLINE_CACHE_PATHS } from "@/lib/api/offline-cache";
import {
  accountsOutput,
  enrolOutput,
  mfaStatusOutput,
  removeOutput,
  verifyOutput,
} from "@/server/auth/mfa-schemas";

// P2-1 A10 (docs/plans/2026-11-12-p2-1-totp.md section 3.4, 5 A10): the self-service routes of the second factor, with a mocked Supabase client. No secret and no
// code is stored, logged or returned beyond the one enrolment reply (AT-T10). Fixture secret and code are fakes.
let client: FakeSupabase;
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => report);

const status = await import("@/app/api/me/mfa/route");
const enrol = await import("@/app/api/me/mfa/factors/route");
const remove = await import("@/app/api/me/mfa/factors/[id]/route");
const verify = await import("@/app/api/me/mfa/factors/[id]/verify/route");
const accounts = await import("@/app/api/mfa/accounts/route");

const SECRET = "JBSWY3DPEHPK3PXP";
const CODE = "123456";
const F1 = "f0000000-0000-4000-8000-000000000001";
const F2 = "f0000000-0000-4000-8000-000000000002";
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/></svg>';
const NOW = Date.parse("2026-11-20T10:00:00Z");

type Script = Record<string, { data: unknown; error: { code?: string; message: string } | null }[]>;
const ok = (data: unknown = null) => [{ data, error: null }];
const fail = (code: string, message = "x") => [{ data: null, error: { code, message } }];
const STATUS = {
  role: "owner",
  mode: "enrolled",
  hasVerifiedFactor: true,
  gate: "challenge",
  issuer: "Osteria Demo A",
};
const factor = (id: string, name: string, state: "verified" | "unverified", type = "totp") => ({
  id,
  friendly_name: name,
  factor_type: type,
  status: state,
  created_at: "2026-11-12T09:30:00.000Z",
  updated_at: "2026-11-12T09:30:00.000Z",
});
const FULL: Script = {
  mfa_status: ok(STATUS),
  mfa_attempt_allowed: ok({ allowed: true, retryAfterSeconds: 0 }),
  mfa_record_failure: ok(),
  mfa_enrol_check: ok({ issuer: "Osteria Demo A", friendlyName: "Principale" }),
  mfa_record_enrolled: ok(true),
  mfa_unenrol_check: ok(),
  mfa_record_unenrolled: ok(true),
  mfa_accounts: ok([]),
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
const factorCtx = (id = F1) => routeContext({ id });
const post = (path: string, body: unknown) => jsonRequest(`http://localhost:3000${path}`, body);
const del = (path: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });
const get = (path: string) => new Request(`http://localhost:3000${path}`);
const loggedText = () =>
  JSON.stringify([report.reportError.mock.calls, consoleSpies.flatMap((s) => s.mock.calls)]);
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

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

describe("GET /api/me/mfa", () => {
  const withFactors = (all: unknown[], level: string) => {
    make();
    client.auth.mfa.listFactors.mockResolvedValue(authReply({ all, totp: [] }));
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(
      authReply({ currentLevel: level, nextLevel: "aal2", currentAuthenticationMethods: [] }),
    );
  };

  it("answers the exact shape, with the slots, at aal1 (gated: nothing can be added yet)", async () => {
    withFactors(
      [factor(F1, "Principale", "verified"), factor(F2, "Riserva", "unverified")],
      "aal1",
    );
    const response = await status.GET(get("/api/me/mfa"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mfaStatusOutput.parse(body)).toEqual(body);
    expect(body).toEqual({
      role: "owner",
      mode: "enrolled",
      gate: "challenge",
      currentLevel: "aal1",
      factors: [
        { id: F1, slot: "principale", status: "verified", createdAt: "2026-11-12T09:30:00.000Z" },
        { id: F2, slot: "riserva", status: "unverified", createdAt: "2026-11-12T09:30:00.000Z" },
      ],
      canAddFactor: false,
      lockedUntil: null,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    [0, "aal1", true],
    [1, "aal2", true],
    [1, "aal1", false],
    [2, "aal2", false],
  ])("canAddFactor with %i verified factor(s) at %s is %s", async (n, level, expected) => {
    const all = [factor(F1, "Principale", "verified"), factor(F2, "Riserva", "verified")].slice(
      0,
      n,
    );
    withFactors(all, level);
    expect((await (await status.GET(get("/api/me/mfa"))).json()).canAddFactor).toBe(expected);
  });

  it("ignores factors that are not TOTP (a phone factor is never ours)", async () => {
    withFactors([factor(F1, "Telefono", "verified", "phone")], "aal1");
    expect((await (await status.GET(get("/api/me/mfa"))).json()).factors).toEqual([]);
  });

  it("a name set outside the app is the slot altro", async () => {
    withFactors([factor(F1, "Il mio telefono", "verified")], "aal2");
    expect((await (await status.GET(get("/api/me/mfa"))).json()).factors[0].slot).toBe("altro");
  });

  it("a locked account shows lockedUntil, from the seconds Postgres gives", async () => {
    make({ ...FULL, mfa_attempt_allowed: ok({ allowed: false, retryAfterSeconds: 600 }) });
    const body = await (await status.GET(get("/api/me/mfa"))).json();
    expect(body.lockedUntil).toBe(new Date(NOW + 600_000).toISOString());
  });

  it.each(["chef", "waiter"])("%s gets 403 and no RPC", async (role) => {
    make(FULL, { ...claimsFor(role), aal: "aal1" });
    expect((await status.GET(get("/api/me/mfa"))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("works for an owner at aal1 whose gate says challenge: the route is exempt (no mfa_gate call)", async () => {
    withFactors([factor(F1, "Principale", "verified")], "aal1");
    expect((await status.GET(get("/api/me/mfa"))).status).toBe(200);
    expect(names()).not.toContain("mfa_gate");
  });

  it("no session is 401", async () => {
    make(FULL, null);
    expect((await status.GET(get("/api/me/mfa"))).status).toBe(401);
  });
});

describe("POST /api/me/mfa/factors (start the enrolment)", () => {
  const start = (slot: unknown = "principale") => enrol.POST(post("/api/me/mfa/factors", { slot }));
  const enrolled = (svg = SVG) =>
    authReply({
      id: F1,
      type: "totp",
      friendly_name: "Principale",
      totp: { qr_code: svg, secret: SECRET, uri: `otpauth://totp/x?secret=${SECRET}` },
    });

  it("checks in Postgres, clears own unverified factors, then enrols with the check's values; 201 with the image and the key", async () => {
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
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(enrolOutput.parse(body)).toEqual(body);
    expect(body.factorId).toBe(F1);
    expect(body.slot).toBe("principale");
    expect(body.secret).toBe(SECRET);
    expect(body.qrImage.startsWith("data:image/svg+xml;utf-8,%3Csvg")).toBe(true);
    expect(decodeURIComponent(body.qrImage.slice("data:image/svg+xml;utf-8,".length))).toBe(SVG);
    expect(client.rpc).toHaveBeenCalledWith("mfa_enrol_check", { p_slot: "principale" });
    expect(client.auth.mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: F2 });
    expect(client.auth.mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Principale",
      issuer: "Osteria Demo A",
    });
    const order = [
      client.rpc.mock.invocationCallOrder[0] ?? 0,
      client.auth.mfa.unenroll.mock.invocationCallOrder[0] ?? 0,
      client.auth.mfa.enroll.mock.invocationCallOrder[0] ?? 0,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("the image as supabase-js really returns it (already a data URL) is accepted and re-encoded; 201", async () => {
    make();
    client.auth.mfa.enroll.mockResolvedValue(enrolled(`data:image/svg+xml;utf-8,${SVG}`));
    const response = await start();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(decodeURIComponent(body.qrImage.slice("data:image/svg+xml;utf-8,".length))).toBe(SVG);
  });

  it("a data-URL SVG with a script is refused too: 502 and the new factor is removed", async () => {
    make();
    client.auth.mfa.enroll.mockResolvedValue(
      enrolled("data:image/svg+xml;utf-8,<svg><script>alert(1)</script></svg>"),
    );
    client.auth.mfa.unenroll.mockResolvedValue(authReply({ id: F1 }));
    const response = await start();
    expect(response.status).toBe(502);
    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: F1 });
  });

  it("a Supabase SVG with a script is refused: 502, nothing returned, the new factor is removed", async () => {
    make();
    client.auth.mfa.enroll.mockResolvedValue(enrolled("<svg><script>alert(1)</script></svg>"));
    const response = await start();
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("script");
    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: F1 });
  });

  it("a Supabase image that is not an SVG is refused the same way", async () => {
    make();
    client.auth.mfa.enroll.mockResolvedValue(enrolled("<html>not an svg</html>"));
    expect((await start()).status).toBe(502);
  });

  it.each([
    ["mfa_required", 403, "mfa_required"],
    ["mfa_factor_limit", 409, "mfa_factor_limit"],
    ["mfa_slot_taken", 409, "mfa_slot_taken"],
  ])("mfa_enrol_check %s -> %i and no Auth call", async (message, httpStatus, code) => {
    make({ ...FULL, mfa_enrol_check: fail("P0001", message) });
    const response = await start();
    expect(response.status).toBe(httpStatus);
    expect((await response.json()).error.code).toBe(code);
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled();
    expect(client.auth.mfa.listFactors).not.toHaveBeenCalled();
  });

  it("an unknown slot or an extra field is 400 and nothing is called", async () => {
    make();
    expect((await start("altro")).status).toBe(400);
    expect(
      (await enrol.POST(post("/api/me/mfa/factors", { slot: "principale", friendlyName: "Mario" })))
        .status,
    ).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it("a Supabase failure is 502 and a Supabase 429 is 429 rate_limited", async () => {
    make();
    client.auth.mfa.enroll.mockResolvedValue(authReply(null, authError(500, "unexpected_failure")));
    expect((await start()).status).toBe(502);
    client.auth.mfa.enroll.mockResolvedValue(
      authReply(null, authError(429, "over_request_rate_limit")),
    );
    const limited = await start();
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("rate_limited");
  });

  it.each(["chef", "waiter"])("%s gets 403", async (role) => {
    make(FULL, { ...claimsFor(role), aal: "aal1" });
    expect((await start()).status).toBe(403);
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled();
  });
});

describe("POST /api/me/mfa/factors/:id/verify (finish the enrolment)", () => {
  const send = (code: unknown = CODE, id = F1) =>
    verify.POST(post(`/api/me/mfa/factors/${id}/verify`, { code }), factorCtx(id));
  const verified = () =>
    authReply({
      access_token: "t",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "r",
      user: {},
    });
  const afterVerify = () =>
    client.auth.mfa.listFactors.mockResolvedValue(
      authReply({ all: [factor(F1, "Principale", "verified")], totp: [] }),
    );

  it("a code that is not six digits is 400 with no RPC and no Auth call", async () => {
    make();
    for (const code of ["12345", "1234567", "12345a", "", 123456, null]) {
      expect((await send(code)).status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a locked account is 429 mfa_locked with retryAfterSeconds and no Auth call", async () => {
    make({ ...FULL, mfa_attempt_allowed: ok({ allowed: false, retryAfterSeconds: 420 }) });
    const response = await send();
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("mfa_locked");
    expect(body.error.details).toEqual({ retryAfterSeconds: 420 });
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(names()).toEqual(["mfa_attempt_allowed"]);
  });

  it("success: one challengeAndVerify (never a separate challenge and verify), then the record, 200 aal2", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(verified());
    afterVerify();
    const response = await send();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(verifyOutput.parse(body)).toEqual(body);
    expect(body).toEqual({
      factor: {
        id: F1,
        slot: "principale",
        status: "verified",
        createdAt: "2026-11-12T09:30:00.000Z",
      },
      currentLevel: "aal2",
    });
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledTimes(1);
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: F1, code: CODE });
    expect("challenge" in client.auth.mfa).toBe(false);
    expect("verify" in client.auth.mfa).toBe(false);
    expect(names()).toEqual(["mfa_attempt_allowed", "mfa_record_enrolled"]);
    expect(client.rpc).toHaveBeenCalledWith("mfa_record_enrolled", { p_factor: F1 });
    expect(client.auth.mfa.challengeAndVerify.mock.invocationCallOrder[0]).toBeLessThan(
      client.rpc.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it("a wrong code records a failure at stage enrol, then 422 mfa_code_invalid (never 401), and no enrolment record", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(
        null,
        authError(400, "mfa_verification_failed", `Invalid TOTP code entered ${CODE}`),
      ),
    );
    const response = await send();
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("mfa_code_invalid");
    expect(names()).toEqual(["mfa_attempt_allowed", "mfa_record_failure"]);
    expect(client.rpc).toHaveBeenCalledWith("mfa_record_failure", { p_stage: "enrol" });
  });

  it("an expired challenge is 422 mfa_challenge_expired and counts as no wrong code", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(422, "mfa_challenge_expired")),
    );
    const response = await send();
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("mfa_challenge_expired");
    expect(names()).toEqual(["mfa_attempt_allowed"]);
  });

  it("a Supabase 429 is 429 rate_limited, not a wrong code", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(429, "over_request_rate_limit")),
    );
    const response = await send();
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("rate_limited");
    expect(names()).toEqual(["mfa_attempt_allowed"]);
  });

  it("an unknown factor is 404, any other Supabase failure is 502", async () => {
    make();
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(404, "mfa_factor_not_found")),
    );
    expect((await send()).status).toBe(404);
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(500, "unexpected_failure")),
    );
    expect((await send()).status).toBe(502);
  });

  it("a failing record after a good verify is reported (code only) and the answer is still 200", async () => {
    make({ ...FULL, mfa_record_enrolled: fail("XX000", `detail ${SECRET}`) });
    client.auth.mfa.challengeAndVerify.mockResolvedValue(verified());
    afterVerify();
    expect((await send()).status).toBe(200);
    expect(report.reportError).toHaveBeenCalledTimes(1);
    expect(loggedText()).not.toContain(SECRET);
  });

  it("a failing mfa_record_failure does not hide the 422", async () => {
    make({ ...FULL, mfa_record_failure: fail("XX000", "boom") });
    client.auth.mfa.challengeAndVerify.mockResolvedValue(
      authReply(null, authError(400, "mfa_verification_failed")),
    );
    expect((await send()).status).toBe(422);
    expect(report.reportError).toHaveBeenCalledTimes(1);
  });

  it("a malformed factor id is 404 with no call", async () => {
    make();
    expect((await send(CODE, "x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an attempt-check failure is a 500 and no Auth call is made", async () => {
    make({ ...FULL, mfa_attempt_allowed: fail("XX000", "boom") });
    expect((await send()).status).toBe(500);
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me/mfa/factors/:id", () => {
  const send = (id = F1) => remove.DELETE(del(`/api/me/mfa/factors/${id}`), factorCtx(id));

  it("checks in Postgres, removes at Supabase, then records: 200 removed", async () => {
    make();
    client.auth.mfa.unenroll.mockResolvedValue(authReply({ id: F1 }));
    const response = await send();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(removeOutput.parse(body)).toEqual(body);
    expect(names()).toEqual(["mfa_unenrol_check", "mfa_record_unenrolled"]);
    expect(client.rpc).toHaveBeenCalledWith("mfa_unenrol_check", { p_factor: F1 });
    expect(client.rpc).toHaveBeenCalledWith("mfa_record_unenrolled", { p_factor: F1 });
    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: F1 });
    expect(client.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      client.auth.mfa.unenroll.mock.invocationCallOrder[0] ?? 0,
    );
    expect(client.auth.mfa.unenroll.mock.invocationCallOrder[0]).toBeLessThan(
      client.rpc.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it.each([
    ["mfa_required", 403],
    ["mfa_last_factor", 409],
    ["mfa_factor_not_found", 404],
  ])("%s -> %i and nothing is removed", async (message, httpStatus) => {
    make({ ...FULL, mfa_unenrol_check: fail("P0001", message) });
    const response = await send();
    expect(response.status).toBe(httpStatus);
    expect((await response.json()).error.code).toBe(
      message === "mfa_factor_not_found" ? "not_found" : message,
    );
    expect(client.auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it("a Supabase failure is 502 and nothing is recorded", async () => {
    make();
    client.auth.mfa.unenroll.mockResolvedValue(
      authReply(null, authError(500, "unexpected_failure")),
    );
    expect((await send()).status).toBe(502);
    expect(names()).toEqual(["mfa_unenrol_check"]);
  });

  it("a failing record after a good removal is reported and the answer is still 200", async () => {
    make({ ...FULL, mfa_record_unenrolled: fail("XX000", "boom") });
    client.auth.mfa.unenroll.mockResolvedValue(authReply({ id: F1 }));
    expect((await send()).status).toBe(200);
    expect(report.reportError).toHaveBeenCalledTimes(1);
  });

  it("a malformed id is 404 and chef and waiter are 403", async () => {
    make();
    expect((await send("x")).status).toBe(404);
    for (const role of ["chef", "waiter"]) {
      make(FULL, { ...claimsFor(role), aal: "aal1" });
      expect((await send()).status).toBe(403);
    }
  });
});

describe("GET /api/mfa/accounts (read-only status of the other accounts)", () => {
  const ROWS = [
    { id: F1, displayName: "Admin Riserva Demo", role: "admin", factorCount: 0 },
    { id: F2, displayName: "Titolare Demo", role: "owner", factorCount: 2 },
  ];

  it("answers the exact shape from public.mfa_accounts, counts only", async () => {
    make({ ...FULL, mfa_accounts: ok(ROWS) }, { ...claimsFor("admin"), aal: "aal2" });
    const response = await accounts.GET(get("/api/mfa/accounts"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(accountsOutput.parse(body)).toEqual(body);
    expect(body).toEqual({ accounts: ROWS });
    expect(names()).toEqual(["mfa_accounts"]);
  });

  it.each(["chef", "waiter"])("%s gets 403 and no RPC", async (role) => {
    make(FULL, { ...claimsFor(role), aal: "aal1" });
    expect((await accounts.GET(get("/api/mfa/accounts"))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("is gated: an admin at aal1 whose gate says challenge gets 403 mfa_required and no read", async () => {
    make(
      { ...FULL, mfa_gate: ok("challenge"), mfa_accounts: ok(ROWS) },
      { ...claimsFor("admin"), aal: "aal1" },
    );
    const response = await accounts.GET(get("/api/mfa/accounts"));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("mfa_required");
    expect(names()).toEqual(["mfa_gate"]);
  });

  it("a Postgres refusal (42501) is 403", async () => {
    make(
      { ...FULL, mfa_accounts: fail("42501", "insufficient_privilege") },
      { ...claimsFor("admin"), aal: "aal2" },
    );
    expect((await accounts.GET(get("/api/mfa/accounts"))).status).toBe(403);
  });
});

describe("hygiene: no secret and no code leaves the app", () => {
  it("the offline allowlist is exactly what it was before P2-1", () => {
    expect([...OFFLINE_CACHE_PATHS]).toEqual([
      "/api/me",
      "/api/menu",
      "/api/tables",
      "/api/table-sessions/:id/lines",
    ]);
  });

  it("across every failure path, no body, report or console line contains the secret or the code", async () => {
    const poisoned = (status: number, code: string) =>
      authReply(
        null,
        authError(
          status,
          code,
          `secret ${SECRET} code ${CODE} uri otpauth://totp/x?secret=${SECRET}`,
        ),
      );
    const bodies: string[] = [];
    const run = async (call: () => Promise<Response>) => {
      const response = await call();
      expect(response.status).toBeGreaterThanOrEqual(400);
      bodies.push(await response.text());
    };

    make();
    client.auth.mfa.enroll.mockResolvedValue(poisoned(500, "unexpected_failure"));
    await run(() => enrol.POST(post("/api/me/mfa/factors", { slot: "principale" })));
    client.auth.mfa.enroll.mockResolvedValue(poisoned(429, "over_request_rate_limit"));
    await run(() => enrol.POST(post("/api/me/mfa/factors", { slot: "principale" })));
    client.auth.mfa.enroll.mockResolvedValue(
      authReply({
        id: F1,
        type: "totp",
        totp: {
          qr_code: "<svg><script>x</script></svg>",
          secret: SECRET,
          uri: `otpauth://totp/x?secret=${SECRET}`,
        },
      }),
    );
    await run(() => enrol.POST(post("/api/me/mfa/factors", { slot: "principale" })));
    for (const [status, code] of [
      [400, "mfa_verification_failed"],
      [422, "mfa_challenge_expired"],
      [429, "over_request_rate_limit"],
      [404, "mfa_factor_not_found"],
      [500, "unexpected_failure"],
    ] as const) {
      client.auth.mfa.challengeAndVerify.mockResolvedValue(poisoned(status, code));
      await run(() =>
        verify.POST(post(`/api/me/mfa/factors/${F1}/verify`, { code: CODE }), factorCtx()),
      );
    }
    client.auth.mfa.unenroll.mockResolvedValue(poisoned(500, "unexpected_failure"));
    await run(() => remove.DELETE(del(`/api/me/mfa/factors/${F1}`), factorCtx()));
    make({
      ...FULL,
      mfa_record_failure: fail("XX000", `boom ${CODE} ${SECRET}`),
      mfa_attempt_allowed: ok({ allowed: true, retryAfterSeconds: 0 }),
    });
    client.auth.mfa.challengeAndVerify.mockResolvedValue(poisoned(400, "mfa_verification_failed"));
    await run(() =>
      verify.POST(post(`/api/me/mfa/factors/${F1}/verify`, { code: CODE }), factorCtx()),
    );
    await run(() =>
      verify.POST(post(`/api/me/mfa/factors/${F1}/verify`, { code: "12" }), factorCtx()),
    );

    const everything = bodies.join("\n") + loggedText();
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(CODE);
    expect(everything).not.toContain("otpauth");
  });
});
