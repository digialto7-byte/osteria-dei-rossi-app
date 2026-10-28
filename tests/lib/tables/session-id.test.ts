import { afterEach, describe, expect, it, vi } from "vitest";
import { newSessionId } from "@/lib/tables/session-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("newSessionId", () => {
  it("uses crypto.randomUUID when the browser has it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "5e000000-0000-4000-8000-0000000000aa" });
    expect(newSessionId()).toBe("5e000000-0000-4000-8000-0000000000aa");
  });

  it("falls back to a version 4 id from getRandomValues (an http page has no randomUUID)", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => (bytes[index] = (index * 37 + 11) % 256));
        return bytes;
      },
    });
    expect(newSessionId()).toMatch(UUID_V4);
  });

  it("two ids differ", () => {
    expect(newSessionId()).not.toBe(newSessionId());
    expect(newSessionId()).toMatch(UUID_V4);
  });
});
