import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";

/** A recorded response (a fixture name or a body), an HTTP error, or a request that never answers. */
export type FakeReply =
  | { fixture: string; status?: number }
  | { body: unknown; status: number; headers?: Record<string, string> }
  | { hang: true };

export interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(process.cwd(), "tests/fixtures/extraction", `${name}.json`), "utf8"),
  );

export const errorBody = (type: string, message = "fake error") => ({
  type: "error",
  error: { type, message },
  request_id: "req_fake_error",
});

/**
 * A fake `fetch` for `new Anthropic({ fetch })`: the real SDK parses the recorded responses and
 * builds its real error classes. Replies are consumed in order; asking for more throws.
 */
export function fakeAnthropicFetch(replies: FakeReply[]) {
  const queue = [...replies];
  const calls: CapturedRequest[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({
      url: String(input),
      headers,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const reply = queue.shift();
    if (!reply) throw new Error("fakeAnthropicFetch: no reply left");
    if ("hang" in reply) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      });
    }
    const body = "fixture" in reply ? fixture(reply.fixture) : reply.body;
    return new Response(JSON.stringify(body), {
      status: reply.status ?? 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_fake_1",
        ...("headers" in reply ? reply.headers : {}),
      },
    });
  });
  return { fetchImpl, calls };
}
