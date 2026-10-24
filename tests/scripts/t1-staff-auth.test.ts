import { describe, expect, it, vi } from "vitest";
import {
  formatReport,
  resolveTarget,
  runSpike,
  type SpikeDeps,
} from "../../scripts/lib/t1-staff-auth";

const OLD_PASSWORD = "A".repeat(43);
const NEW_PASSWORD = "B".repeat(43);
const SECRET = "fake-secret-key-do-not-print";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;

const GOOD_CLAIMS = { session_id: "s-1", amr: [{ method: "password", timestamp: 1 }] };

type Session = { access_token: string; refresh_token: string };
type SignInResult = { session: Session | null; error: { status?: number; code?: string } | null };

function makeDeps(overrides: Partial<SpikeDeps> = {}, signInOverride?: SpikeDeps["signIn"]) {
  const passwords = [OLD_PASSWORD, NEW_PASSWORD];
  let current = OLD_PASSWORD;
  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  const updateUserById = vi.fn().mockImplementation(async (_id: string, attrs) => {
    current = (attrs as { password: string }).password;
    return { error: null };
  });
  const signIn = vi.fn<SpikeDeps["signIn"]>(
    signInOverride ??
      (async (_email, password): Promise<SignInResult> =>
        password === current
          ? { session: { access_token: jwt(GOOD_CLAIMS), refresh_token: "r-1" }, error: null }
          : { session: null, error: { status: 400, code: "invalid_credentials" } }),
  );
  const refresh = vi.fn<SpikeDeps["refresh"]>(async () => ({
    session: { access_token: jwt(GOOD_CLAIMS), refresh_token: "r-2" },
    error: null,
  }));
  const deps: SpikeDeps = {
    admin: { createUser, updateUserById, deleteUser },
    signIn,
    refresh,
    staffMailCount: async () => 0,
    sleep: vi.fn(async () => {}),
    findUserIdByEmail: vi.fn(async () => null),
    newId: () => "11111111-1111-4111-8111-111111111111",
    newPassword: () => passwords.shift() ?? NEW_PASSWORD,
    ...overrides,
  };
  return { deps, createUser, updateUserById, deleteUser, signIn, refresh };
}

const byId = (report: Awaited<ReturnType<typeof runSpike>>, id: string) =>
  report.checks.find((check) => check.id === id);

describe("resolveTarget", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321"])("accepts %s as local", (url) => {
    expect(resolveTarget({ argv: [], env: {}, supabaseUrl: url })).toBe("local");
  });

  it("refuses a non-local URL without the staging flag, naming no value", () => {
    const url = "https://abcd.supabase.co";
    expect(() => resolveTarget({ argv: [], env: {}, supabaseUrl: url })).toThrow(/local/i);
    try {
      resolveTarget({ argv: [], env: {}, supabaseUrl: url });
    } catch (error) {
      expect(String(error)).not.toContain("abcd");
    }
  });

  it("refuses a look-alike host", () => {
    for (const url of ["http://127.0.0.1.evil.test", "http://localhost.evil.test", "not a url"]) {
      expect(() => resolveTarget({ argv: [], env: {}, supabaseUrl: url })).toThrow();
    }
  });

  it("refuses --target staging without T1_STAGING_OK=yes", () => {
    const url = "https://abcd.supabase.co";
    const argv = ["--target", "staging"];
    expect(() => resolveTarget({ argv, env: {}, supabaseUrl: url })).toThrow(/T1_STAGING_OK/);
    expect(() => resolveTarget({ argv, env: { T1_STAGING_OK: "true" }, supabaseUrl: url })).toThrow(
      /T1_STAGING_OK/,
    );
  });

  it("allows staging only with both the argument and the flag", () => {
    expect(
      resolveTarget({
        argv: ["--target", "staging"],
        env: { T1_STAGING_OK: "yes" },
        supabaseUrl: "https://abcd.supabase.co",
      }),
    ).toBe("staging");
  });

  it("refuses a flag without the argument", () => {
    expect(() =>
      resolveTarget({
        argv: [],
        env: { T1_STAGING_OK: "yes" },
        supabaseUrl: "https://abcd.supabase.co",
      }),
    ).toThrow();
  });
});

describe("runSpike", () => {
  it("passes all five checks on a healthy stack and deletes the user it created", async () => {
    const { deps, createUser, deleteUser, signIn } = makeDeps();
    const report = await runSpike(deps, "local");
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => [check.id, check.ok])).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
      ["e", true],
    ]);
    expect(createUser).toHaveBeenCalledWith({
      email: "staff-11111111-1111-4111-8111-111111111111@staff.invalid",
      password: OLD_PASSWORD,
      email_confirm: true,
    });
    expect(signIn.mock.calls.length).toBeGreaterThanOrEqual(31);
    expect(deleteUser).toHaveBeenCalledWith("u-1");
  });

  it("(a) fails and stops when createUser is refused, with nothing to delete", async () => {
    const { deps, deleteUser, signIn } = makeDeps();
    deps.admin.createUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "email_address_invalid" },
    });
    const report = await runSpike(deps, "local");
    expect(report.ok).toBe(false);
    expect(byId(report, "a")?.ok).toBe(false);
    expect(signIn).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("(b) fails when mail was sent to the staff domain", async () => {
    const { deps } = makeDeps({ staffMailCount: async () => 1 });
    const report = await runSpike(deps, "local");
    expect(report.ok).toBe(false);
    expect(byId(report, "b")?.ok).toBe(false);
  });

  it("(b) fails on local when the mail catcher is not configured; is skipped on staging", async () => {
    const local = await runSpike(makeDeps({ staffMailCount: null }).deps, "local");
    expect(byId(local, "b")?.ok).toBe(false);
    const staging = await runSpike(makeDeps({ staffMailCount: null }).deps, "staging");
    expect(byId(staging, "b")).toMatchObject({ ok: true, skipped: true });
  });

  it("(c) fails and reports the count when a sign-in returns 429", async () => {
    let calls = 0;
    const { deps, deleteUser } = makeDeps({}, async () => {
      calls += 1;
      return calls === 12
        ? { session: null, error: { status: 429, code: "over_request_rate_limit" } }
        : { session: { access_token: jwt(GOOD_CLAIMS), refresh_token: "r" }, error: null };
    });
    const report = await runSpike(deps, "local");
    expect(report.ok).toBe(false);
    expect(byId(report, "c")?.ok).toBe(false);
    expect(byId(report, "c")?.detail).toMatch(/429/);
    expect(deleteUser).toHaveBeenCalled();
  });

  it("(c) records the 31st sign-in outcome for information only", async () => {
    let calls = 0;
    const { deps } = makeDeps({}, async () => {
      calls += 1;
      return calls === 31
        ? { session: null, error: { status: 429, code: "over_request_rate_limit" } }
        : { session: { access_token: jwt(GOOD_CLAIMS), refresh_token: "r" }, error: null };
    });
    const report = await runSpike(deps, "local");
    expect(byId(report, "c")?.ok).toBe(true);
    expect(byId(report, "c")?.detail).toMatch(/31st/);
  });

  it("(d) fails when the old password still works after the change", async () => {
    const { deps } = makeDeps();
    deps.admin.updateUserById = vi.fn().mockResolvedValue({ error: null });
    const report = await runSpike(deps, "local");
    expect(byId(report, "d")?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  it("(d) fails when updateUserById errors", async () => {
    const { deps } = makeDeps();
    deps.admin.updateUserById = vi.fn().mockResolvedValue({ error: { status: 500 } });
    expect(byId(await runSpike(deps, "local"), "d")?.ok).toBe(false);
  });

  it("(e) fails when the token has no session_id", async () => {
    const claims = { amr: [{ method: "password" }] };
    const { deps } = makeDeps({}, async () => ({
      session: { access_token: jwt(claims), refresh_token: "r" },
      error: null,
    }));
    const report = await runSpike(deps, "local");
    expect(byId(report, "e")?.ok).toBe(false);
  });

  it("(e) fails when amr[0].method is not password", async () => {
    const claims = { session_id: "s-1", amr: [{ method: "otp" }] };
    const { deps } = makeDeps({}, async () => ({
      session: { access_token: jwt(claims), refresh_token: "r" },
      error: null,
    }));
    expect(byId(await runSpike(deps, "local"), "e")?.ok).toBe(false);
  });

  it("(e) fails when the session_id changes after a refresh", async () => {
    const { deps } = makeDeps();
    deps.refresh = async () => ({
      session: { access_token: jwt({ ...GOOD_CLAIMS, session_id: "s-2" }), refresh_token: "r" },
      error: null,
    });
    expect(byId(await runSpike(deps, "local"), "e")?.ok).toBe(false);
  });

  it("(d) and (e) still pass when the window limiter answers 429 to every sign-in from the 31st on", async () => {
    // A lasting limit: once the 30-per-window budget is spent, every later call is 429 too.
    let current = OLD_PASSWORD;
    let calls = 0;
    const { deps } = makeDeps({}, async (_email, password) => {
      calls += 1;
      if (calls > 30)
        return { session: null, error: { status: 429, code: "over_request_rate_limit" } };
      return password === current
        ? { session: { access_token: jwt(GOOD_CLAIMS), refresh_token: "r-1" }, error: null }
        : { session: null, error: { status: 400, code: "invalid_credentials" } };
    });
    deps.admin.updateUserById = vi.fn(async (_id: string, attrs: { password: string }) => {
      current = attrs.password;
      return { error: null };
    });
    const report = await runSpike(deps, "local");
    expect(report.checks.map((check) => [check.id, check.ok])).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
      ["e", true],
    ]);
    expect(report.ok).toBe(true);
    expect(byId(report, "c")?.detail).toMatch(/31st: status 429/);
  });

  it("(d) reports a 429 as rate limited / inconclusive, never as the old password accepted", async () => {
    const { deps } = makeDeps({}, async (_email, password) =>
      password === OLD_PASSWORD
        ? { session: null, error: { status: 429, code: "over_request_rate_limit" } }
        : { session: { access_token: jwt(GOOD_CLAIMS), refresh_token: "r" }, error: null },
    );
    const check = byId(await runSpike(deps, "local"), "d");
    expect(check?.ok).toBe(false);
    expect(check?.inconclusive).toBe(true);
    expect(check?.detail).toMatch(/rate limited/i);
    expect(check?.detail).not.toMatch(/old password accepted/i);
  });

  it("(d) failing because the old password works is not marked inconclusive", async () => {
    const { deps } = makeDeps();
    deps.admin.updateUserById = vi.fn().mockResolvedValue({ error: null });
    const check = byId(await runSpike(deps, "local"), "d");
    expect(check?.ok).toBe(false);
    expect(check?.inconclusive).toBeUndefined();
  });

  it("(e) reports a 429 on its sign-in as rate limited / inconclusive", async () => {
    const { deps } = makeDeps({}, async () => ({
      session: null,
      error: { status: 429, code: "over_request_rate_limit" },
    }));
    const check = byId(await runSpike(deps, "local"), "e");
    expect(check).toMatchObject({ ok: false, inconclusive: true });
    expect(check?.detail).toMatch(/rate limited/i);
  });

  it("runs the (d) and (e) sign-ins before the 30-sign-in burst, within a 30 sign-in budget", async () => {
    const { deps, signIn } = makeDeps();
    await runSpike(deps, "local");
    // e: 1, d: 2 (old, new), then the burst tops the run up to 30, then the 31st.
    expect(signIn.mock.calls).toHaveLength(31);
    expect(signIn.mock.calls[1]?.[1]).toBe(OLD_PASSWORD);
    expect(signIn.mock.calls[2]?.[1]).toBe(NEW_PASSWORD);
  });

  it("(b) polls the mail catcher for 3 s in 250 ms steps and fails on a late mail", async () => {
    const counts = [0, 0, 0, 1];
    const staffMailCount = vi.fn(async () => counts.shift() ?? 1);
    const { deps } = makeDeps({ staffMailCount });
    const report = await runSpike(deps, "local");
    expect(byId(report, "b")?.ok).toBe(false);
    expect(staffMailCount).toHaveBeenCalledTimes(4);
    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledWith(250);
  });

  it("(b) passes only after reading zero for the whole 3 s", async () => {
    const staffMailCount = vi.fn(async () => 0);
    const { deps } = makeDeps({ staffMailCount });
    expect(byId(await runSpike(deps, "local"), "b")?.ok).toBe(true);
    expect(staffMailCount).toHaveBeenCalledTimes(13);
    expect(deps.sleep).toHaveBeenCalledTimes(12);
  });

  it("deletes a user found by its e-mail when createUser throws after GoTrue created it", async () => {
    const { deps, deleteUser } = makeDeps();
    deps.admin.createUser = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const findUserIdByEmail = vi.fn(async () => "u-orphan");
    deps.findUserIdByEmail = findUserIdByEmail;
    const report = await runSpike(deps, "local");
    expect(findUserIdByEmail).toHaveBeenCalledWith(
      "staff-11111111-1111-4111-8111-111111111111@staff.invalid",
    );
    expect(deleteUser).toHaveBeenCalledWith("u-orphan");
    expect(report.ok).toBe(false);
    expect(report.cleanup).toEqual({ created: 1, deleted: 1 });
  });

  it("deletes nothing when createUser threw and no such user exists", async () => {
    const { deps, deleteUser } = makeDeps();
    deps.admin.createUser = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const report = await runSpike(deps, "local");
    expect(deleteUser).not.toHaveBeenCalled();
    expect(report.ok).toBe(false);
    expect(report.cleanup).toEqual({ created: 0, deleted: 0 });
  });

  it("reports a failed cleanup when the look-up after a thrown createUser fails", async () => {
    const { deps } = makeDeps();
    deps.admin.createUser = vi.fn().mockRejectedValue(new Error("socket hang up"));
    deps.findUserIdByEmail = vi.fn().mockRejectedValue(new Error("down"));
    const report = await runSpike(deps, "local");
    expect(report.ok).toBe(false);
  });

  // The real client turns a dropped connection (status 0) and a 502/503/504 into a returned error, not
  // a throw: GoTrue may still have created the user, so it is looked up and deleted.
  it.each([
    ["a dropped connection", { status: 0, code: "unexpected_failure" }],
    ["a gateway timeout", { status: 504, code: "unexpected_failure" }],
    ["an error without a status", { code: "unexpected_failure" }],
  ])("deletes the user found by its e-mail when createUser answers %s", async (_case, error) => {
    const { deps, deleteUser } = makeDeps();
    deps.admin.createUser = vi.fn().mockResolvedValue({ data: { user: null }, error });
    const findUserIdByEmail = vi.fn(async () => "u-orphan");
    deps.findUserIdByEmail = findUserIdByEmail;
    const report = await runSpike(deps, "local");
    expect(findUserIdByEmail).toHaveBeenCalledWith(
      "staff-11111111-1111-4111-8111-111111111111@staff.invalid",
    );
    expect(deleteUser).toHaveBeenCalledWith("u-orphan");
    expect(report.ok).toBe(false);
    expect(report.cleanup).toEqual({ created: 1, deleted: 1 });
  });

  it("deletes a user whose id came back together with an error", async () => {
    const { deps, deleteUser } = makeDeps();
    deps.admin.createUser = vi.fn().mockResolvedValue({
      data: { user: { id: "u-half" } },
      error: { status: 500, code: "unexpected_failure" },
    });
    const report = await runSpike(deps, "local");
    expect(deleteUser).toHaveBeenCalledWith("u-half");
    expect(report.ok).toBe(false);
    expect(report.cleanup).toEqual({ created: 1, deleted: 1 });
  });

  it("does not look anyone up when createUser answered with an error", async () => {
    const { deps } = makeDeps();
    deps.admin.createUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "email_address_invalid" },
    });
    await runSpike(deps, "local");
    expect(deps.findUserIdByEmail).not.toHaveBeenCalled();
  });

  it("deletes the user even when a step throws, and reports the failure", async () => {
    const { deps, deleteUser } = makeDeps();
    deps.refresh = async () => {
      throw new Error("network down");
    };
    const report = await runSpike(deps, "local");
    expect(report.ok).toBe(false);
    expect(deleteUser).toHaveBeenCalledWith("u-1");
  });

  it("reports a failed cleanup as a failure", async () => {
    const { deps } = makeDeps();
    deps.admin.deleteUser = vi.fn().mockResolvedValue({ error: { status: 500 } });
    const report = await runSpike(deps, "local");
    expect(report.ok).toBe(false);
    expect(report.cleanup).toEqual({ created: 1, deleted: 0 });
  });
});

describe("formatReport", () => {
  it("is one JSON line with the target and every check, and carries no secret or password", async () => {
    const { deps } = makeDeps();
    const report = await runSpike(deps, "local");
    const line = formatReport(report);
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line) as { target: string; ok: boolean; checks: unknown[] };
    expect(parsed).toMatchObject({ target: "local", ok: true });
    expect(parsed.checks).toHaveLength(5);
    for (const secret of [SECRET, OLD_PASSWORD, NEW_PASSWORD, "access_token", "refresh_token"]) {
      expect(line).not.toContain(secret);
    }
  });

  it("does not include the synthetic email addresses", async () => {
    const line = formatReport(await runSpike(makeDeps().deps, "local"));
    expect(line).not.toContain("staff-");
  });
});
