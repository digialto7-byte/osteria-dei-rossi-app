import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, type Mock } from "vitest";
import { CheckCrash, type AuthResult } from "../../../scripts/lib/sp00/common";
import { parseSignInMail, readNewestMail } from "../../../scripts/lib/sp00/mail";
import type { CaseReport } from "../../../scripts/lib/sp00/report";
import { runT1, type T1Deps } from "../../../scripts/lib/sp00/t1";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256" })}.${b64(claims)}.c2lnbmF0dXJl`;
const SID = "11111111-1111-4111-8111-111111111111";

const probe = (m: string, sid = true) => ({ m, sid, keys: ["aal", "session_id"] });
const token = (m: string, extra: Record<string, unknown> = {}) =>
  jwt({ session_id: SID, aal: "aal1", sp0_in: probe(m), ...extra });

const ok = (m: string, extra: Record<string, unknown> = {}, refresh = "r-1"): AuthResult => ({
  status: 200,
  code: null,
  session: { accessToken: token(m, extra), refreshToken: refresh },
});

const PREFLIGHT_OK: CaseReport = { id: "preflight", result: "pass", detail: { status: 200 } };
const LINK =
  "http://127.0.0.1:54321/auth/v1/verify?token=abcdef0123456789&type=magiclink&redirect_to=http://localhost:3000";

type Mocked = { [K in keyof T1Deps]: Mock<T1Deps[K]> };

function makeDeps(overrides: Partial<T1Deps> = {}): Mocked {
  let mailN = 0;
  const base: T1Deps = {
    createUser: async () => ({ id: "u-1", status: 200, code: null }),
    deleteUser: async () => ({ error: null }),
    passwordSignIn: async () => ok("password"),
    refresh: async () => ok("token_refresh", {}, "r-2"),
    sendCode: async () => {},
    mailMessage: async () => {
      mailN += 1;
      return { id: `m-${mailN}`, code: "123456", link: LINK };
    },
    generateLink: async () => ({
      status: 200,
      code: null,
      emailOtp: "654321",
      actionLink: "https://x.test/verify",
    }),
    verifyEmailCode: async () => ok("otp"),
    pkceStart: async () => ({ verifier: "v" }),
    followRedirect: async () => ({
      status: 302,
      location: "http://localhost:3000/auth/callback?code=pkce-code",
    }),
    pkceExchange: async () => ok("magiclink"),
    enrolTotp: async () => ({
      status: 200,
      code: null,
      factorId: "f-1",
      secret: "JBSWY3DPEHPK3PXP",
    }),
    verifyTotp: async () => ok("totp", { aal: "aal2" }),
    totpCode: () => "000000",
    newId: () => "a1b2c3d4-0000-4000-8000-123456789012",
    newPassword: () => "P".repeat(43),
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(base).map(([name, fn]) => [name, vi.fn(fn as (...args: never[]) => unknown)]),
  ) as unknown as Mocked;
}

const byId = (cases: CaseReport[], id: string) => cases.find((c) => c.id === id);
const results = (cases: CaseReport[]) => cases.map((c) => [c.id, c.result]);

describe("runT1: the five cases", () => {
  it("passes all five locally and records sp0_in.m for each", async () => {
    const { cases } = await runT1(makeDeps(), "local", null);
    expect(results(cases)).toEqual([
      ["1", "pass"],
      ["2", "pass"],
      ["3", "pass"],
      ["4", "pass"],
      ["5", "pass"],
    ]);
    expect(cases.map((c) => c.detail.m)).toEqual([
      "password",
      "otp",
      "magiclink",
      "token_refresh",
      "totp",
    ]);
    expect(byId(cases, "2")?.detail.flow).toBe("mailpit");
    expect(byId(cases, "3")?.detail.flow).toBe("pkce");
  });

  it("each case fails when sp0_in.sid is false", async () => {
    const noSid = (m: string): AuthResult => ({
      status: 200,
      code: null,
      session: {
        accessToken: jwt({ session_id: SID, sp0_in: probe(m, false) }),
        refreshToken: "r",
      },
    });
    const cases = [
      ["1", { passwordSignIn: async () => noSid("password") }],
      ["2", { verifyEmailCode: async () => noSid("otp") }],
      ["3", { pkceExchange: async () => noSid("magiclink") }],
      ["4", { refresh: async () => noSid("token_refresh") }],
      ["5", { verifyTotp: async () => noSid("totp") }],
    ] as const;
    for (const [id, override] of cases) {
      const report = await runT1(makeDeps(override), "local", null);
      expect(byId(report.cases, id)?.result, `case ${id}`).toBe("fail");
      expect(byId(report.cases, id)?.detail.sid, `case ${id}`).toBe(false);
    }
  });

  it("a token without sp0_in fails with 'probe hook not installed'", async () => {
    const bare: AuthResult = {
      status: 200,
      code: null,
      session: { accessToken: jwt({ session_id: SID }), refreshToken: "r" },
    };
    const { cases } = await runT1(makeDeps({ passwordSignIn: async () => bare }), "local", null);
    expect(byId(cases, "1")).toEqual({
      id: "1",
      result: "fail",
      detail: { reason: "probe hook not installed" },
    });
  });

  it("a refresh or a TOTP verification that changes session_id fails", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const refreshed = await runT1(
      makeDeps({ refresh: async () => ok("token_refresh", { session_id: other }) }),
      "local",
      null,
    );
    expect(byId(refreshed.cases, "4")?.result).toBe("fail");
    expect(byId(refreshed.cases, "4")?.detail.sameSession).toBe(false);
    const verified = await runT1(
      makeDeps({ verifyTotp: async () => ok("totp", { session_id: other }) }),
      "local",
      null,
    );
    expect(byId(verified.cases, "5")?.result).toBe("fail");
    expect(byId(verified.cases, "5")?.detail.sameSession).toBe(false);
  });

  it("a token with no session_id fails even when sid is true", async () => {
    const result: AuthResult = {
      status: 200,
      code: null,
      session: { accessToken: jwt({ sp0_in: probe("password") }), refreshToken: "r" },
    };
    const { cases } = await runT1(makeDeps({ passwordSignIn: async () => result }), "local", null);
    expect(byId(cases, "1")?.result).toBe("fail");
    expect(byId(cases, "1")?.detail.sessionIdPresent).toBe(false);
  });

  it("an unreadable token fails the case", async () => {
    const result: AuthResult = {
      status: 200,
      code: null,
      session: { accessToken: "not-a-jwt", refreshToken: "r" },
    };
    const { cases } = await runT1(makeDeps({ passwordSignIn: async () => result }), "local", null);
    expect(byId(cases, "1")?.result).toBe("fail");
    expect(byId(cases, "1")?.detail.reason).toBe("token not readable");
  });

  it("a refused sign-in fails with the status and code, and 429 is inconclusive", async () => {
    const refused: AuthResult = { status: 400, code: "invalid_credentials", session: null };
    const failed = await runT1(makeDeps({ passwordSignIn: async () => refused }), "local", null);
    expect(byId(failed.cases, "1")).toEqual({
      id: "1",
      result: "fail",
      detail: { status: 400, code: "invalid_credentials" },
    });
    const limited: AuthResult = { status: 429, code: "over_request_rate_limit", session: null };
    const rate = await runT1(makeDeps({ passwordSignIn: async () => limited }), "local", null);
    expect(byId(rate.cases, "1")?.result).toBe("inconclusive");
  });

  it("cases 4 and 5 are inconclusive when case 1 gave no session, and the others still run", async () => {
    const refused: AuthResult = { status: 400, code: "invalid_credentials", session: null };
    const { cases } = await runT1(makeDeps({ passwordSignIn: async () => refused }), "local", null);
    expect(byId(cases, "4")).toEqual({
      id: "4",
      result: "inconclusive",
      detail: { reason: "no session from case 1" },
    });
    expect(byId(cases, "5")?.result).toBe("inconclusive");
    expect(byId(cases, "2")?.result).toBe("pass");
  });

  it("a thrown error is inconclusive with the error name only", async () => {
    const deps = makeDeps({
      verifyEmailCode: async () => {
        throw new TypeError("fetch failed https://x.supabase.co");
      },
    });
    const { cases } = await runT1(deps, "local", null);
    expect(byId(cases, "2")).toEqual({
      id: "2",
      result: "inconclusive",
      detail: { reason: "request failed", error: "TypeError" },
    });
  });

  it("a TOTP enrolment that is refused fails case 5 with status and code", async () => {
    const deps = makeDeps({
      enrolTotp: async () => ({
        status: 422,
        code: "mfa_totp_enroll_not_enabled",
        factorId: null,
        secret: null,
      }),
    });
    const { cases } = await runT1(deps, "local", null);
    expect(byId(cases, "5")).toEqual({
      id: "5",
      result: "fail",
      detail: { status: 422, code: "mfa_totp_enroll_not_enabled" },
    });
  });
});

describe("runT1: local and hosted flows", () => {
  it("local: sends the mail for cases 2 and 3, follows the PKCE redirect to a code and exchanges it", async () => {
    const deps = makeDeps();
    await runT1(deps, "local", null);
    expect(deps.sendCode).toHaveBeenCalledTimes(1);
    expect(deps.pkceStart).toHaveBeenCalledTimes(1);
    expect(deps.mailMessage).toHaveBeenCalledTimes(2);
    expect(deps.verifyEmailCode.mock.calls[0]?.[1]).toBe("123456");
    expect(deps.followRedirect.mock.calls[0]?.[0]).toBe(LINK);
    expect(deps.pkceExchange.mock.calls[0]?.[1]).toBe("pkce-code");
    expect(deps.generateLink).not.toHaveBeenCalled();
  });

  it("local: the second mail is read with the first mail's id as known, so it is another message", async () => {
    const deps = makeDeps();
    await runT1(deps, "local", null);
    expect(deps.mailMessage.mock.calls[0]?.[1]).toEqual([]);
    expect(deps.mailMessage.mock.calls[1]?.[1]).toEqual(["m-1"]);
  });

  it("local: a redirect without a code fails case 3 with the status", async () => {
    const deps = makeDeps({
      followRedirect: async () => ({
        status: 302,
        location: "http://localhost:3000/login?error=x",
      }),
    });
    const { cases } = await runT1(deps, "local", null);
    expect(byId(cases, "3")).toEqual({
      id: "3",
      result: "fail",
      detail: { reason: "no code in the redirect", status: 302 },
    });
  });

  it("local: a mail with no code (case 2) or no link (case 3) fails that case", async () => {
    const noCode = await runT1(
      makeDeps({ mailMessage: async () => ({ id: "m", code: null, link: LINK }) }),
      "local",
      null,
    );
    expect(byId(noCode.cases, "2")?.detail.reason).toBe("the mail has no code");
    const noLink = await runT1(
      makeDeps({ mailMessage: async () => ({ id: "m", code: "123456", link: null }) }),
      "local",
      null,
    );
    expect(byId(noLink.cases, "3")?.detail.reason).toBe("the mail has no link");
  });

  it("hosted: two separate generateLink calls (cases 2 and 3), no mail, the implicit redirect is read and labelled", async () => {
    const generate = vi
      .fn<T1Deps["generateLink"]>()
      .mockResolvedValueOnce({
        status: 200,
        code: null,
        emailOtp: "654321",
        actionLink: "https://x.test/a",
      })
      .mockResolvedValueOnce({
        status: 200,
        code: null,
        emailOtp: "111111",
        actionLink: "https://x.test/b",
      });
    const tokens = `${token("magiclink")}`;
    const deps = makeDeps({
      generateLink: generate,
      followRedirect: async () => ({
        status: 303,
        location: `http://localhost:3000/#access_token=${tokens}&refresh_token=r-9&token_type=bearer`,
      }),
    });
    const { cases } = await runT1(deps, "temp", PREFLIGHT_OK);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(deps.verifyEmailCode.mock.calls[0]?.[1]).toBe("654321");
    expect(deps.followRedirect.mock.calls[0]?.[0]).toBe("https://x.test/b");
    expect(deps.sendCode).not.toHaveBeenCalled();
    expect(deps.mailMessage).not.toHaveBeenCalled();
    expect(deps.pkceStart).not.toHaveBeenCalled();
    expect(byId(cases, "2")?.detail.flow).toBe("generateLink");
    expect(byId(cases, "3")).toMatchObject({
      result: "pass",
      detail: { flow: "implicit", m: "magiclink" },
    });
  });

  it("hosted: a redirect without tokens fails case 3", async () => {
    const deps = makeDeps({
      followRedirect: async () => ({
        status: 303,
        location: "http://localhost:3000/#error=access_denied",
      }),
    });
    const { cases } = await runT1(deps, "temp", PREFLIGHT_OK);
    expect(byId(cases, "3")).toEqual({
      id: "3",
      result: "fail",
      detail: { reason: "no tokens in the redirect", status: 303, flow: "implicit" },
    });
  });

  it("hosted: a generateLink without an OTP or a link fails its case", async () => {
    const deps = makeDeps({
      generateLink: async () => ({ status: 200, code: null, emailOtp: null, actionLink: null }),
    });
    const { cases } = await runT1(deps, "temp", PREFLIGHT_OK);
    expect(byId(cases, "2")?.result).toBe("fail");
    expect(byId(cases, "3")?.result).toBe("fail");
  });

  it("a failed preflight runs nothing and makes every case inconclusive", async () => {
    const deps = makeDeps();
    const failed: CaseReport = {
      id: "preflight",
      result: "inconclusive",
      detail: { status: 401, reason: "secret key not injected" },
    };
    const { cases, cleanup } = await runT1(deps, "temp", failed);
    expect(results(cases)).toEqual(["1", "2", "3", "4", "5"].map((id) => [id, "inconclusive"]));
    for (const fn of Object.values(deps)) expect(fn).not.toHaveBeenCalled();
    expect(cleanup).toEqual({ created: 0, deleted: 0, kept: 0 });
  });

  it("refuses to run hosted without a preflight result", async () => {
    await expect(runT1(makeDeps(), "temp", null)).rejects.toThrow(/preflight/);
  });
});

describe("runT1: the user and the report", () => {
  it("the T1 user has no membership: created with a 43-character password, an example.test address, and deleted", async () => {
    const deps = makeDeps();
    const { cleanup } = await runT1(deps, "local", null);
    const [email, password] = deps.createUser.mock.calls[0] as unknown as [string, string];
    expect(email).toMatch(/^sp0-t1-[a-z0-9]+@example\.test$/);
    expect(password).toHaveLength(43);
    expect(deps.deleteUser).toHaveBeenCalledWith("u-1");
    expect(cleanup).toEqual({ created: 1, deleted: 1, kept: 0 });
  });

  it("deletes the user even when a case throws", async () => {
    const deps = makeDeps({
      passwordSignIn: async () => {
        throw new Error("boom");
      },
    });
    const { cleanup } = await runT1(deps, "local", null);
    expect(cleanup.deleted).toBe(1);
  });

  it("a deleteUser that throws keeps the five cases and the counts in a CheckCrash", async () => {
    const deps = makeDeps({
      deleteUser: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const crash = await runT1(deps, "local", null).catch((e: unknown) => e);
    expect(crash).toBeInstanceOf(CheckCrash);
    const partial = (crash as CheckCrash).partial;
    expect(partial.cases.map((c) => c.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(partial.cleanup).toEqual({ created: 1, deleted: 0, kept: 1 });
    expect((crash as CheckCrash).cause).toBeInstanceOf(TypeError);
  });

  it("a user that cannot be deleted fails the check through a 'cleanup' case", async () => {
    const deps = makeDeps({ deleteUser: async () => ({ error: { message: "no" } }) });
    const { cases, cleanup } = await runT1(deps, "local", null);
    expect(byId(cases, "cleanup")).toEqual({
      id: "cleanup",
      result: "fail",
      detail: { undeleted: 1 },
    });
    expect(cleanup).toEqual({ created: 1, deleted: 0, kept: 1 });
  });

  it("a refused user creation is a 'setup' fail and no case runs", async () => {
    const deps = makeDeps({
      createUser: async () => ({ id: null, status: 422, code: "email_exists" }),
    });
    const { cases, cleanup } = await runT1(deps, "local", null);
    expect(cases).toEqual([
      { id: "setup", result: "fail", detail: { status: 422, code: "email_exists" } },
    ]);
    expect(deps.passwordSignIn).not.toHaveBeenCalled();
    expect(cleanup).toEqual({ created: 0, deleted: 0, kept: 0 });
  });

  it("never puts a token, a TOTP secret, an address or a URL into a case", async () => {
    const { cases } = await runT1(makeDeps(), "local", null);
    expect(JSON.stringify(cases)).not.toMatch(/@|https?:|eyJ|JBSWY3DP|pkce-code|123456/);
  });

  it("the TOTP code is computed from the secret and never reported", async () => {
    const deps = makeDeps({
      totpCode: (secret: string) => (secret === "JBSWY3DPEHPK3PXP" ? "424242" : "bad"),
    });
    const { cases } = await runT1(deps, "local", null);
    expect(deps.verifyTotp.mock.calls[0]?.[2]).toBe("424242");
    expect(JSON.stringify(cases)).not.toContain("424242");
  });
});

describe("the sign-in mail (Mailpit)", () => {
  const template = readFileSync(join(process.cwd(), "supabase/templates/magic-link.html"), "utf8");
  // Mailpit's text part of the rendered template: tags removed, the link and the code in place.
  const rendered = template
    .replaceAll("{{ .ConfirmationURL }}", LINK)
    .replaceAll("{{ .Token }}", "482913")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g, "$2 [ $1 ]")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n\s*\n+/g, "\n");

  it("extracts the 6-digit code and the verify link from the rendered magic-link template", () => {
    expect(parseSignInMail(rendered)).toEqual({ code: "482913", link: LINK });
  });

  it("does not take digits from the link's token as the code", () => {
    const text =
      "Entra [ http://127.0.0.1:54321/auth/v1/verify?token=123456&type=magiclink ]\nnessun codice";
    expect(parseSignInMail(text).code).toBeNull();
  });

  it("does not take six digits inside a longer word or id as the code", () => {
    expect(parseSignInMail("riferimento A123456 e ref-123456 e 1234567").code).toBeNull();
  });

  it("returns nulls for a text with neither", () => {
    expect(parseSignInMail("ciao")).toEqual({ code: null, link: null });
  });

  const messages = (ids: [string, string][]) => ({
    messages: ids.map(([ID, Address]) => ({ ID, To: [{ Address }] })),
  });
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("reads the newest message for the address that is not known, and parses it", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/api/v1/messages"))
        return respond(
          messages([
            ["m2", "Me@Example.test"],
            ["m1", "me@example.test"],
            ["x", "other@example.test"],
          ]),
        );
      return respond({ Text: rendered });
    }) as unknown as typeof fetch;
    const deps = {
      mailpitUrl: "http://m",
      fetchImpl,
      sleep: vi.fn(async () => {}),
      attempts: 3,
      pollMs: 10,
    };
    expect(await readNewestMail(deps, "me@example.test", [])).toEqual({
      id: "m2",
      code: "482913",
      link: LINK,
    });
    expect((await readNewestMail(deps, "me@example.test", ["m2"])).id).toBe("m1");
  });

  it("polls, sleeping between looks, then throws without naming the address", async () => {
    const fetchImpl = vi.fn(async () => respond(messages([]))) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const error = await readNewestMail(
      { mailpitUrl: "http://m", fetchImpl, sleep, attempts: 3, pollMs: 7 },
      "me@example.test",
      [],
    ).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/No new sign-in e-mail/);
    expect((error as Error).message).not.toContain("me@example.test");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it("throws when the catcher answers an error status", async () => {
    const fetchImpl = vi.fn(async () => respond({}, 500)) as unknown as typeof fetch;
    await expect(
      readNewestMail(
        { mailpitUrl: "http://m", fetchImpl, sleep: async () => {}, attempts: 1, pollMs: 1 },
        "a@example.test",
        [],
      ),
    ).rejects.toThrow(/answered 500/);
  });
});
