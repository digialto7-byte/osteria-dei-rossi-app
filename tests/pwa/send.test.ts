import { afterEach, describe, expect, it, vi } from "vitest";
import { SYNC_REQUEST_TIMEOUT_MS } from "@/server/sync/constants";
import { sendOps } from "@/pwa/send";
import { opId, syncOutputOf } from "../helpers/sync-data";

// The adapter between apiJson and the replay engine (M20 plan §3.1.7 step 5).
const OPS = [
  {
    opId: opId(1),
    seq: 1,
    kind: "add_line" as const,
    clientTs: "2026-11-02T19:30:00.000Z",
    userId: opId(9),
    payload: {},
  },
];
const reply = (status: number, body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

describe("sendOps", () => {
  it("posts the ops as JSON to /api/sync and returns the parsed output on a 200", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const output = syncOutputOf([]);
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(output), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await sendOps(OPS, fetchImpl)).toEqual({ kind: "ok", output });
    expect(calls[0]!.url).toBe("/api/sync");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ ops: OPS });
    expect((calls[0]!.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
  });

  it("a thrown fetch is a network failure", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect(await sendOps(OPS, fetchImpl)).toEqual({ kind: "network" });
  });

  it.each([
    [401, { kind: "unauthorized" }],
    [403, { kind: "forbidden" }],
    [503, { kind: "server", status: 503 }],
    [500, { kind: "server", status: 500 }],
    [429, { kind: "server", status: 429 }],
    [413, { kind: "server", status: 413 }],
    [400, { kind: "server", status: 400 }],
  ])("status %i", async (status, expected) => {
    expect(await sendOps(OPS, reply(status, { error: { code: "x", message: "y" } }))).toEqual(
      expected,
    );
  });

  it("a 200 that is not the sync output is a server failure, not a crash (a captive portal page)", async () => {
    expect(await sendOps(OPS, reply(200, { hello: "wifi login" }))).toEqual({
      kind: "server",
      status: 200,
    });
    const html = (async () => new Response("<html>login</html>", { status: 200 })) as typeof fetch;
    expect(await sendOps(OPS, html)).toEqual({ kind: "server", status: 200 });
  });

  describe("the request timeout (the replay lease is longer than this)", () => {
    afterEach(() => vi.useRealTimers());
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;

    it("a request that never answers is aborted after the timeout and counts as a network failure", async () => {
      vi.useFakeTimers();
      const pending = sendOps(OPS, hanging);
      await vi.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS - 1);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ kind: "network" });
    });

    it("an answer in time is not aborted, and its timer is cleared", async () => {
      vi.useFakeTimers();
      const output = syncOutputOf([]);
      const fetchImpl = (async () =>
        new Response(JSON.stringify(output), { status: 200 })) as unknown as typeof fetch;
      expect(await sendOps(OPS, fetchImpl)).toEqual({ kind: "ok", output });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
