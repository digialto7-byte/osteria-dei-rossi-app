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
