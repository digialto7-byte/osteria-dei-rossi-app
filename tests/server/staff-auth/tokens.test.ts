import { describe, expect, it } from "vitest";
import {
  ENROLMENT_CODE_ALPHABET,
  ENROLMENT_CODE_LENGTH,
  DEVICE_TOKEN_BYTES,
} from "@/server/staff-auth/constants";
import {
  displayCode,
  generateDeviceToken,
  generateEnrolmentCode,
  hashIp,
  normaliseCode,
  sha256Hex,
} from "@/server/staff-auth/tokens";

const PEPPER = "test-pepper-not-a-secret-0123456789abcdef";

describe("generateEnrolmentCode", () => {
  it("is 8 characters of the Crockford base32 alphabet", () => {
    const code = generateEnrolmentCode();
    expect(code).toHaveLength(ENROLMENT_CODE_LENGTH);
    expect(ENROLMENT_CODE_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    for (const ch of code) expect(ENROLMENT_CODE_ALPHABET).toContain(ch);
  });

  it("maps byte values to alphabet positions", () => {
    const bytes = Uint8Array.from([0, 1, 10, 31, 32, 33, 63, 255]);
    const code = generateEnrolmentCode(() => bytes);
    const expected = [0, 1, 10, 31, 0, 1, 31, 31].map((i) => ENROLMENT_CODE_ALPHABET[i]).join("");
    expect(code).toBe(expected);
  });

  it("gives 10 000 distinct codes with a near-uniform first character", () => {
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    for (let n = 0; n < 10_000; n += 1) {
      const code = generateEnrolmentCode();
      seen.add(code);
      counts.set(code[0]!, (counts.get(code[0]!) ?? 0) + 1);
    }
    expect(seen.size).toBe(10_000);
    const expected = 10_000 / 32;
    let chi2 = 0;
    for (const ch of ENROLMENT_CODE_ALPHABET) {
      const observed = counts.get(ch) ?? 0;
      chi2 += (observed - expected) ** 2 / expected;
    }
    // 31 degrees of freedom: 70 is far beyond the 99.99th percentile (about 61).
    expect(chi2).toBeLessThan(70);
  });
});

describe("displayCode and normaliseCode", () => {
  it("shows the code as K7M2-QX9P", () => {
    expect(displayCode("K7M2QX9P")).toBe("K7M2-QX9P");
  });

  it("normalises case, spaces and dashes", () => {
    expect(normaliseCode(" k7m2-qx9p ")).toBe("K7M2QX9P");
  });

  it("reads I and L as 1, and O as 0", () => {
    expect(normaliseCode("IlOo-0000")).toBe("11000000");
  });

  it("is idempotent", () => {
    expect(normaliseCode(normaliseCode("k7m2 qx9p"))).toBe("K7M2QX9P");
  });
});

describe("hashes and tokens", () => {
  it("sha256Hex matches a known vector", () => {
    expect(sha256Hex("K7M2QX9P")).toBe(
      "aca467967182579cd17036951428176d16d1fe096aa8debf3524dee706b30830",
    );
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("a device token is 32 random bytes as base64url, different every time", () => {
    const token = generateDeviceToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(DEVICE_TOKEN_BYTES);
    expect(generateDeviceToken()).not.toBe(token);
  });

  it("uses the injected random source for the token", () => {
    const token = generateDeviceToken(() => new Uint8Array(32).fill(255));
    expect(Buffer.from(token, "base64url").equals(Buffer.alloc(32, 255))).toBe(true);
  });

  it("the IP hash is an HMAC with the pepper, matching an independent vector", () => {
    expect(hashIp(PEPPER, "203.0.113.7")).toBe(
      "d21a051e820bff505e691c26cba81d4fa826deaf77232b62c09430ec1a77589f",
    );
  });

  it("the IP hash differs per pepper and per address, and is 64 hex characters", () => {
    expect(hashIp(`${PEPPER}x`, "203.0.113.7")).not.toBe(hashIp(PEPPER, "203.0.113.7"));
    expect(hashIp(PEPPER, "203.0.113.8")).not.toBe(hashIp(PEPPER, "203.0.113.7"));
    expect(hashIp(PEPPER, "unknown")).toMatch(/^[0-9a-f]{64}$/);
  });
});
