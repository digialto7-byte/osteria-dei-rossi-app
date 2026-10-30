import { describe, expect, it, vi } from "vitest";
import { readTablesThroughWorker } from "@/pwa/read-tables";

// The refresh counts only an answer from the network: the worker's own copy (x-offline-cached-at) is what it replies when the network fails or
// is slow, and storing nothing new is a failed refresh that must be tried again.
const ok = (extra = {}) => ({ ok: true as const, status: 200, data: {}, ...extra });

describe("readTablesThroughWorker", () => {
  it("is true for a live 200", async () => {
    const read = vi.fn(async () => ok());
    expect(await readTablesThroughWorker(read)).toBe(true);
    expect(read).toHaveBeenCalledWith("/api/tables");
  });

  it("is false when the worker answered from its copy, on any error, and when the read throws", async () => {
    expect(
      await readTablesThroughWorker(async () => ok({ cachedAt: "2026-10-30T10:00:00.000Z" })),
    ).toBe(false);
    expect(
      await readTablesThroughWorker(async () => ({
        ok: false as const,
        status: 0,
        error: { code: "network", message: "x" },
      })),
    ).toBe(false);
    expect(
      await readTablesThroughWorker(async () => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });
});
