import { describe, expect, it } from "vitest";
import {
  isRecentSignIn,
  isSessionExpired,
  lastAuthAt,
  RECENT_SIGN_IN_MINUTES,
  SESSION_MAX_AGE_DAYS,
  signedInAt,
  signInMethod,
} from "@/lib/auth/session-age";

// 2026-10-20T10:00:00Z; 30 x 86 400 s later is 2026-11-19T10:00:00Z, across the 25 October DST change.
const T = Date.UTC(2026, 9, 20, 10, 0, 0) / 1000;
const at = (iso: string) => Date.parse(iso);
const pw = (timestamp: number) => ({ amr: [{ method: "password", timestamp }] });

describe("constants", () => {
  it("are 30 days and 10 minutes", () => {
    expect(SESSION_MAX_AGE_DAYS).toBe(30);
    expect(RECENT_SIGN_IN_MINUTES).toBe(10);
  });
});

describe("isSessionExpired", () => {
  it("is false one second before 30 days and true at 30 days, across the DST change", () => {
    expect(isSessionExpired(pw(T), at("2026-11-19T09:59:59Z"))).toBe(false);
    expect(isSessionExpired(pw(T), at("2026-11-19T10:00:00Z"))).toBe(true);
  });

  it("fails closed on a missing, empty or malformed amr", () => {
    const now = at("2026-10-21T00:00:00Z");
    expect(isSessionExpired({}, now)).toBe(true);
    expect(isSessionExpired({ amr: [] }, now)).toBe(true);
    expect(isSessionExpired({ amr: [{ method: "password", timestamp: "x" as never }] }, now)).toBe(
      true,
    );
    expect(isSessionExpired({ amr: [{ method: "password", timestamp: NaN }] }, now)).toBe(true);
  });

  it("counts from the earliest entry", () => {
    const claims = {
      amr: [
        { method: "totp", timestamp: T + 86_400 * 20 },
        { method: "password", timestamp: T },
      ],
    };
    expect(isSessionExpired(claims, at("2026-11-19T10:00:00Z"))).toBe(true);
  });
});

describe("signedInAt and lastAuthAt", () => {
  it("take the earliest and the latest timestamp", () => {
    const claims = {
      amr: [
        { method: "totp", timestamp: T + 60 },
        { method: "password", timestamp: T },
      ],
    };
    expect(signedInAt(claims)).toBe(T);
    expect(lastAuthAt(claims)).toBe(T + 60);
  });

  it("are null without a usable entry", () => {
    expect(signedInAt({})).toBeNull();
    expect(lastAuthAt({ amr: [] })).toBeNull();
  });
});

describe("isRecentSignIn", () => {
  const now = at("2026-10-20T12:00:00Z");
  const nowS = now / 1000;
  it("is true 9 minutes ago, false 11 minutes ago and false at exactly 10", () => {
    expect(isRecentSignIn(pw(nowS - 9 * 60), now)).toBe(true);
    expect(isRecentSignIn(pw(nowS - 11 * 60), now)).toBe(false);
    expect(isRecentSignIn(pw(nowS - 10 * 60), now)).toBe(false);
  });
  it("is false without amr", () => {
    expect(isRecentSignIn({}, now)).toBe(false);
  });
});

describe("signInMethod", () => {
  const m = (method: string, timestamp = T) => ({ amr: [{ method, timestamp }] });
  it("maps the known methods", () => {
    expect(signInMethod(m("password"))).toBe("password");
    for (const x of ["otp", "magiclink", "email", "recovery", "invite"]) {
      expect(signInMethod(m(x))).toBe("link");
    }
    expect(signInMethod(m("oauth"))).toBe("other");
    expect(signInMethod({})).toBe("other");
  });
  it("lets the latest entry decide", () => {
    expect(
      signInMethod({
        amr: [
          { method: "password", timestamp: T },
          { method: "otp", timestamp: T + 5 },
        ],
      }),
    ).toBe("link");
    expect(
      signInMethod({
        amr: [
          { method: "otp", timestamp: T },
          { method: "password", timestamp: T + 5 },
        ],
      }),
    ).toBe("password");
  });
});

// P2-1 A8 (docs/plans/2026-11-12-p2-1-totp.md section 3.8): a TOTP verify adds a `totp` entry to amr. The 30-day cap still counts from the earliest entry (the code
// never extends a session); "recent" counts from the latest, so passing the code is a recent authentication; signInMethod keeps its contract.
describe("a totp entry in amr (second factor)", () => {
  const DAY = 86_400;
  const withTotp = (totpAt: number) => ({
    amr: [
      { method: "totp", timestamp: totpAt },
      { method: "password", timestamp: T },
    ],
  });

  it("does not extend the session: expired at T + 30 days exactly, not before, even with a code entered 20 days in", () => {
    const claims = withTotp(T + 20 * DAY);
    expect(isSessionExpired(claims, (T + 30 * DAY) * 1000 - 1000)).toBe(false);
    expect(isSessionExpired(claims, (T + 30 * DAY) * 1000)).toBe(true);
  });

  it("counts the 30 days from the earliest entry whatever the order of the list", () => {
    const reversed = {
      amr: [
        { method: "password", timestamp: T },
        { method: "totp", timestamp: T + 60 },
      ],
    };
    expect(signedInAt(reversed)).toBe(T);
    expect(signedInAt(withTotp(T + 60))).toBe(T);
    expect(isSessionExpired(reversed, (T + 30 * DAY) * 1000)).toBe(true);
  });

  it("isRecentSignIn counts the code as an authentication: true at totp + 9 minutes, false at + 10", () => {
    const totpAt = T + 5 * DAY;
    const claims = withTotp(totpAt);
    expect(lastAuthAt(claims)).toBe(totpAt);
    expect(isRecentSignIn(claims, (totpAt + 9 * 60) * 1000)).toBe(true);
    expect(isRecentSignIn(claims, (totpAt + 10 * 60) * 1000)).toBe(false);
  });

  it("signInMethod is other when the latest entry is totp (the contract is unchanged)", () => {
    expect(signInMethod(withTotp(T + 30))).toBe("other");
    expect(
      signInMethod({
        amr: [
          { method: "totp", timestamp: T + 30 },
          { method: "otp", timestamp: T },
        ],
      }),
    ).toBe("other");
  });
});
