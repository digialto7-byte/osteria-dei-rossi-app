import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reservations plan §5 B6 and ADR-032 decision 5. Fake keys only. Every MAC comparison goes through timingSafeEqual on digests of equal length.
const compare = vi.hoisted(() => ({ calls: [] as [number, number][] }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      compare.calls.push([a.byteLength, b.byteLength]);
      return actual.timingSafeEqual(a, b);
    },
  };
});

const {
  FORM_MAX_AGE_MS,
  FORM_MIN_AGE_MS,
  checkFormToken,
  keyId,
  signCancelToken,
  signFormToken,
  verifyCancelToken,
} = await import("@/server/reservations/public/tokens");
const { GATE_FUNCTIONS, gateArgs, gateMac } = await import("@/server/reservations/public/gate");

const KEY = "test-link-key-0123456789-abcdefghij";
const OLD = "test-old-link-key-0123456789-abcdefg";
const ID = "11111111-1111-4111-8111-111111111111";
const EXP = 1_794_132_000;
const keys = { current: KEY };

beforeEach(() => {
  compare.calls.length = 0;
});

describe("keyId", () => {
  it("is the first 8 hex characters of the key's SHA-256", () => {
    expect(keyId(KEY)).toBe(createHash("sha256").update(KEY).digest("hex").slice(0, 8));
    expect(keyId(KEY)).toMatch(/^[0-9a-f]{8}$/);
    expect(keyId(OLD)).not.toBe(keyId(KEY));
  });
});

describe("cancel token", () => {
  it("has the shape c1.<kid>.<reservationId>.<exp>.<mac> with the plan's MAC", () => {
    const token = signCancelToken(keys, ID, EXP);
    const mac = createHmac("sha256", KEY).update(`resv-cancel|c1|${ID}|${EXP}`).digest("hex");
    expect(token).toBe(`c1.${keyId(KEY)}.${ID}.${EXP}.${mac}`);
  });

  it("round-trips while exp is in the future", () => {
    const token = signCancelToken(keys, ID, EXP);
    expect(verifyCancelToken(keys, token, EXP - 1)).toEqual({ reservationId: ID, exp: EXP });
  });

  it("is invalid from exp on: exp - 1 s passes, exp fails (the SQL closes at exp)", () => {
    const token = signCancelToken(keys, ID, EXP);
    expect(verifyCancelToken(keys, token, EXP - 1)).not.toBeNull();
    expect(verifyCancelToken(keys, token, EXP)).toBeNull();
    expect(verifyCancelToken(keys, token, EXP + 3600)).toBeNull();
  });

  it("rejects a flipped MAC character, a changed id or exp, and a wrong kid", () => {
    const token = signCancelToken(keys, ID, EXP);
    const parts = token.split(".");
    const mac = parts[4]!;
    const flipped = [...parts.slice(0, 4), (mac[0] === "a" ? "b" : "a") + mac.slice(1)].join(".");
    expect(verifyCancelToken(keys, flipped, EXP - 1)).toBeNull();
    const otherId = token.replace(ID, "22222222-2222-4222-8222-222222222222");
    expect(verifyCancelToken(keys, otherId, EXP - 1)).toBeNull();
    const laterExp = [...parts.slice(0, 3), String(EXP + 1), mac].join(".");
    expect(verifyCancelToken(keys, laterExp, EXP - 1)).toBeNull();
    const wrongKid = [parts[0], "00000000", ...parts.slice(2)].join(".");
    expect(verifyCancelToken(keys, wrongKid, EXP - 1)).toBeNull();
  });

  it.each([
    "",
    "garbage",
    "c1.a.b.c",
    "c2.x.y.z.w",
    `c1.${keyId(KEY)}.not-a-uuid.${EXP}.${"a".repeat(64)}`,
    `c1.${keyId(KEY)}.${ID}.abc.${"a".repeat(64)}`,
    `c1.${keyId(KEY)}.${ID}.${EXP}.${"a".repeat(63)}`,
    `c1.${keyId(KEY)}.${ID}.${EXP}.${"A".repeat(64)}`,
    `c1.${keyId(KEY)}.${ID}.${EXP}.${"a".repeat(64)}.extra`,
  ])("rejects the malformed token %j", (token) => {
    expect(verifyCancelToken(keys, token, EXP - 1)).toBeNull();
  });

  it("verifies a token signed with the previous key only while PREVIOUS is set (rotation)", () => {
    const old = signCancelToken({ current: OLD }, ID, EXP);
    expect(verifyCancelToken({ current: KEY, previous: OLD }, old, EXP - 1)).toEqual({
      reservationId: ID,
      exp: EXP,
    });
    expect(verifyCancelToken({ current: KEY }, old, EXP - 1)).toBeNull();
  });

  it("signs with the current key even when a previous one is set", () => {
    const token = signCancelToken({ current: KEY, previous: OLD }, ID, EXP);
    expect(token.split(".")[1]).toBe(keyId(KEY));
  });

  it("compares MACs with timingSafeEqual on equal-length digests", () => {
    verifyCancelToken(keys, signCancelToken(keys, ID, EXP), EXP - 1);
    expect(compare.calls.length).toBeGreaterThan(0);
    for (const [a, b] of compare.calls) expect(a).toBe(b);
  });
});

describe("form token", () => {
  const ISSUED = 1_794_000_000_000;
  const token = signFormToken(keys, "osteria-demo-a", ISSUED);

  it("has the documented bounds: 3 s minimum, 2 h maximum", () => {
    expect(FORM_MIN_AGE_MS).toBe(3000);
    expect(FORM_MAX_AGE_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("is too fast at 2 999 ms and ok at 3 000 ms", () => {
    expect(checkFormToken(keys, "osteria-demo-a", token, ISSUED + 2999)).toBe("too_fast");
    expect(checkFormToken(keys, "osteria-demo-a", token, ISSUED + 3000)).toBe("ok");
  });

  it("is ok at exactly 2 h and expired at 2 h + 1 ms", () => {
    expect(checkFormToken(keys, "osteria-demo-a", token, ISSUED + FORM_MAX_AGE_MS)).toBe("ok");
    expect(checkFormToken(keys, "osteria-demo-a", token, ISSUED + FORM_MAX_AGE_MS + 1)).toBe(
      "expired",
    );
  });

  it("is too fast when it comes from the future", () => {
    expect(checkFormToken(keys, "osteria-demo-a", token, ISSUED - 1000)).toBe("too_fast");
  });

  it("is invalid for another slug, a changed time, a flipped MAC, garbage or a cancel token", () => {
    expect(checkFormToken(keys, "osteria-demo-b", token, ISSUED + 5000)).toBe("invalid");
    const parts = token.split(".");
    const later = [parts[0], parts[1], String(ISSUED - 10_000), parts[3]].join(".");
    expect(checkFormToken(keys, "osteria-demo-a", later, ISSUED + 5000)).toBe("invalid");
    const mac = parts[3]!;
    const flipped = [...parts.slice(0, 3), (mac[0] === "a" ? "b" : "a") + mac.slice(1)].join(".");
    expect(checkFormToken(keys, "osteria-demo-a", flipped, ISSUED + 5000)).toBe("invalid");
    expect(checkFormToken(keys, "osteria-demo-a", "garbage", ISSUED + 5000)).toBe("invalid");
    expect(checkFormToken(keys, "osteria-demo-a", "", ISSUED + 5000)).toBe("invalid");
    expect(
      checkFormToken(keys, "osteria-demo-a", signCancelToken(keys, ID, EXP), ISSUED + 5000),
    ).toBe("invalid");
  });

  it("uses its own purpose prefix, so a cancel MAC cannot stand in for a form MAC", () => {
    const mac = createHmac("sha256", KEY)
      .update(`resv-form|f1|osteria-demo-a|${ISSUED}`)
      .digest("hex");
    expect(token).toBe(`f1.${keyId(KEY)}.${ISSUED}.${mac}`);
  });

  it("verifies with the previous key during a rotation", () => {
    const old = signFormToken({ current: OLD }, "osteria-demo-a", ISSUED);
    expect(
      checkFormToken({ current: KEY, previous: OLD }, "osteria-demo-a", old, ISSUED + 5000),
    ).toBe("ok");
    expect(checkFormToken({ current: KEY }, "osteria-demo-a", old, ISSUED + 5000)).toBe("invalid");
  });
});

describe("gate MAC", () => {
  // The same vector as the SQL half (supabase/tests/database/297): app.reservation_gate_ok computes this with extensions.hmac.
  const GATE_KEY = "test-gate-key-0123456789-abcdefghij";
  const VECTOR = "f993b1292eb6ff5bc03794cec16bcf5ba259fad27a9d9d5316cb60fa904b7178";

  it("equals the SQL's for the shared vector", () => {
    expect(gateMac(GATE_KEY, "request_reservation", "osteria-demo-a", 1794132000)).toBe(VECTOR);
  });

  it("differs by function, slug, ts and key", () => {
    const base = gateMac(GATE_KEY, "request_reservation", "osteria-demo-a", 1794132000);
    expect(gateMac(GATE_KEY, "reservation_page", "osteria-demo-a", 1794132000)).not.toBe(base);
    expect(gateMac(GATE_KEY, "request_reservation", "osteria-demo-b", 1794132000)).not.toBe(base);
    expect(gateMac(GATE_KEY, "request_reservation", "osteria-demo-a", 1794132001)).not.toBe(base);
    expect(gateMac(KEY, "request_reservation", "osteria-demo-a", 1794132000)).not.toBe(base);
  });

  it("builds the three leading RPC arguments with the epoch second of now", () => {
    expect(gateArgs(GATE_KEY, "request_reservation", "osteria-demo-a", 1794132000999)).toEqual({
      p_slug: "osteria-demo-a",
      p_gate_ts: 1794132000,
      p_gate_mac: VECTOR,
    });
  });

  it("names the five anon functions", () => {
    expect([...GATE_FUNCTIONS].sort()).toEqual([
      "cancel_reservation",
      "request_reservation",
      "reservation_cancel_view",
      "reservation_page",
      "reservation_slots",
    ]);
  });
});
