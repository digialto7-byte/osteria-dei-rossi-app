import { describe, expect, it } from "vitest";
import {
  buildReport,
  formatReport,
  type CaseReport,
  type CheckReport,
} from "../../../scripts/lib/sp00/report";

const SECRET = "placeholder-not-a-key";
const CLEANUP = { created: 2, deleted: 1, kept: 1 };

const pass = (id: string, detail: CaseReport["detail"] = {}): CaseReport => ({
  id,
  result: "pass",
  detail,
});

const report = (cases: CaseReport[], overrides: Partial<CheckReport> = {}) =>
  buildReport({
    target: "local",
    check: "t1",
    cases,
    cleanup: CLEANUP,
    authVersion: "unknown",
    ...overrides,
  });

const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a throw");
};

describe("buildReport", () => {
  it("is ok when every case passed", () => {
    expect(report([pass("1"), pass("2")]).ok).toBe(true);
  });

  it.each(["fail", "inconclusive"] as const)("is not ok when a case is %s", (result) => {
    expect(report([pass("1"), { id: "2", result, detail: {} }]).ok).toBe(false);
  });

  it("does not count a recorded case (no pass rule) against ok", () => {
    expect(report([pass("1"), { id: "f", result: "recorded", detail: { status: 200 } }]).ok).toBe(
      true,
    );
  });

  it("is not ok with no case at all: nothing was judged", () => {
    expect(report([]).ok).toBe(false);
  });

  it("keeps created, deleted and kept in the cleanup", () => {
    expect(report([pass("1")]).cleanup).toEqual({ created: 2, deleted: 1, kept: 1 });
  });

  it("rejects a result outside pass, fail, inconclusive, recorded", () => {
    expect(() => report([{ id: "1", result: "ok" as never, detail: {} }])).toThrow(/result/);
  });

  it("rejects a cleanup with a negative or fractional count", () => {
    expect(() => report([pass("1")], { cleanup: { created: -1, deleted: 0, kept: 0 } })).toThrow(
      /cleanup/,
    );
    expect(() => report([pass("1")], { cleanup: { created: 1.5, deleted: 0, kept: 0 } })).toThrow(
      /cleanup/,
    );
  });
});

describe("formatReport", () => {
  it("prints one JSON line with target, check, ok, cases, cleanup and authVersion", () => {
    const line = formatReport(report([pass("1", { sid: true, status: 200 })]), [SECRET]);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      target: "local",
      check: "t1",
      ok: true,
      cases: [{ id: "1", result: "pass", detail: { sid: true, status: 200 } }],
      cleanup: CLEANUP,
      authVersion: "unknown",
    });
  });

  it("allows ids, claim names and status codes", () => {
    const detail = {
      tenant: "11111111-1111-4111-8111-111111111111",
      keys: ["aal", "role", "session_id"],
      m: "otp",
      flow: "implicit",
    };
    expect(() => formatReport(report([pass("1", detail)]), [SECRET])).not.toThrow();
  });

  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: "x" })}.c2lnbmF0dXJl`;

  it.each([
    ["a JWT-shaped string", jwt],
    ["an sb_ key prefix", "sb_secret_abcdef"],
    ["the secret key value", `value ${SECRET}`],
    ["an e-mail address", "someone@example.test"],
    ["an http URL", "http://127.0.0.1:54321/rest"],
    ["an https URL", "https://abcdefghijklmnopqrst.supabase.co"],
    ["a websocket URL", "wss://abcdefghijklmnopqrst.supabase.co/realtime"],
  ])("throws before printing when a detail value holds %s", (_name, value) => {
    const message = refusal(() => formatReport(report([pass("1", { note: value })]), [SECRET]));
    expect(message).toMatch(/report refused/i);
    expect(message).not.toContain(value);
  });

  it("looks inside arrays, case ids, detail keys and the auth version", () => {
    expect(() => formatReport(report([pass("1", { list: ["a", jwt] })]), [SECRET])).toThrow(
      /refused/,
    );
    expect(() => formatReport(report([pass("a@b.test")]), [SECRET])).toThrow(/refused/);
    expect(() => formatReport(report([pass("1", { "a@b.test": true })]), [SECRET])).toThrow(
      /refused/,
    );
    expect(() => formatReport(report([pass("1")], { authVersion: "sb_x" }), [SECRET])).toThrow(
      /refused/,
    );
  });

  it("refuses an empty secret instead of silently matching nothing", () => {
    expect(() => formatReport(report([pass("1")]), [""])).toThrow(/empty secret/i);
  });
});
