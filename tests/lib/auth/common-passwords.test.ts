import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMON_PASSWORD_LIST, COMMON_PASSWORDS } from "@/lib/auth/common-passwords";

describe("COMMON_PASSWORDS", () => {
  it("is strictly sorted (so also unique)", () => {
    for (let i = 1; i < COMMON_PASSWORD_LIST.length; i++) {
      expect(COMMON_PASSWORD_LIST[i - 1]! < COMMON_PASSWORD_LIST[i]!, COMMON_PASSWORD_LIST[i]).toBe(
        true,
      );
    }
    expect(COMMON_PASSWORDS.size).toBe(COMMON_PASSWORD_LIST.length);
  });

  it("holds only lower-case, trimmed entries of 10 or more characters", () => {
    expect(COMMON_PASSWORD_LIST.length).toBeGreaterThan(0);
    for (const word of COMMON_PASSWORD_LIST) {
      expect(word, word).toBe(word.toLowerCase());
      expect(word, word).toBe(word.trim());
      expect(word.length, word).toBeGreaterThanOrEqual(10);
    }
  });

  it("names its source, its commit and its licence in the header", () => {
    const source = readFileSync(
      new URL("../../../src/lib/auth/common-passwords.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /Source:\s+https:\/\/github\.com\/danielmiessler\/SecLists\S*10k-most-common\.txt/,
    );
    expect(source).toMatch(/Commit:\s+[0-9a-f]{40}/);
    expect(source).toMatch(/Licence:\s+MIT/);
  });
});
