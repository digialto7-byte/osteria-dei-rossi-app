import { describe, expect, it, vi } from "vitest";
import { createResendSender } from "@/server/mail/resend";
import { MailError, type MailMessage } from "@/server/mail/types";

// Reservations plan §5 B9: one fetch to Resend, no package (T-R2). Fake key only.
const KEY = "test-key-not-a-secret-resend";
const MESSAGE: MailMessage = {
  to: "cliente.demo@example.com",
  from: "prenotazioni@example.com",
  subject: "Prova",
  text: "Ciao",
  html: "<p>Ciao</p>",
  idempotencyKey: "24000000-0000-4000-8000-0000000000aa",
};

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body), { status }));
const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MailError);
    return error as MailError;
  }
  throw new Error("expected a MailError");
};

describe("createResendSender", () => {
  it("posts the documented request: URL, bearer, idempotency key and the JSON body", async () => {
    const fetchMock = respond(200, { id: "re_123" });
    const result = await createResendSender({ apiKey: KEY, fetch: fetchMock }).send(MESSAGE);
    expect(result).toEqual({ providerId: "re_123" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("idempotency-key")).toBe(MESSAGE.idempotencyKey);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      from: MESSAGE.from,
      to: [MESSAGE.to],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
  });

  it("accepts any 2xx with an id", async () => {
    expect(
      await createResendSender({ apiKey: KEY, fetch: respond(201, { id: "re_9" }) }).send(MESSAGE),
    ).toEqual({ providerId: "re_9" });
  });

  it.each([408, 409, 429, 500, 502, 503, 504])("treats %i as retry", async (status) => {
    const error = await kindOf(
      createResendSender({ apiKey: KEY, fetch: respond(status) }).send(MESSAGE),
    );
    expect(error.kind).toBe("retry");
  });

  // Resend's 409 has two names: concurrent_idempotent_requests (same key in flight: transient) and invalid_idempotent_request (same key, other payload: permanent).
  it("treats a 409 concurrent_idempotent_requests as retry", async () => {
    const error = await kindOf(
      createResendSender({
        apiKey: KEY,
        fetch: respond(409, { name: "concurrent_idempotent_requests", message: "x" }),
      }).send(MESSAGE),
    );
    expect(error.kind).toBe("retry");
    expect(error.message).toBe("resend_http_409");
  });

  it("treats a 409 invalid_idempotent_request as rejected, with a code that holds no body text", async () => {
    const echo = `same key ${MESSAGE.idempotencyKey} for ${MESSAGE.to} ${KEY}`;
    const error = await kindOf(
      createResendSender({
        apiKey: KEY,
        fetch: respond(409, { name: "invalid_idempotent_request", message: echo }),
      }).send(MESSAGE),
    );
    expect(error.kind).toBe("rejected");
    expect(error.message).toBe("resend_http_409_invalid_idempotent_request");
    const seen = `${error.message} ${error.stack ?? ""} ${String(error.cause ?? "")}`;
    expect(seen).not.toContain(MESSAGE.to);
    expect(seen).not.toContain(MESSAGE.idempotencyKey);
    expect(seen).not.toContain(KEY);
  });

  it.each([
    ["a non-JSON body", () => new Response("<html>conflict</html>", { status: 409 })],
    ["an empty body", () => new Response(null, { status: 409 })],
    ["a JSON array", () => new Response("[]", { status: 409 })],
    ["a JSON null", () => new Response("null", { status: 409 })],
    ["a name that is not a string", () => new Response('{"name":5}', { status: 409 })],
    ["an unknown name", () => new Response('{"name":"something_else"}', { status: 409 })],
    [
      "an unreadable body",
      () => {
        const response = new Response("x", { status: 409 });
        Object.defineProperty(response, "text", { value: () => Promise.reject(new Error("boom")) });
        Object.defineProperty(response, "json", { value: () => Promise.reject(new Error("boom")) });
        return response;
      },
    ],
  ])("keeps a 409 with %s retryable", async (_label, make) => {
    const error = await kindOf(
      createResendSender({ apiKey: KEY, fetch: vi.fn(async () => make()) }).send(MESSAGE),
    );
    expect(error.kind).toBe("retry");
    expect(error.message).toBe("resend_http_409");
  });

  it.each([400, 401, 403, 404, 422, 429, 500])(
    "does not read the body of a failing %i, even one named invalid_idempotent_request",
    async (status) => {
      const response = Response.json({ name: "invalid_idempotent_request" }, { status });
      const json = vi.spyOn(response, "json");
      const text = vi.spyOn(response, "text");
      const error = await kindOf(
        createResendSender({ apiKey: KEY, fetch: vi.fn(async () => response) }).send(MESSAGE),
      );
      expect(error.message).toBe(`resend_http_${status}`);
      expect(json).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
    },
  );

  it.each([400, 401, 403, 404, 422])("treats %i as rejected", async (status) => {
    const error = await kindOf(
      createResendSender({ apiKey: KEY, fetch: respond(status) }).send(MESSAGE),
    );
    expect(error.kind).toBe("rejected");
  });

  it("treats a network failure and a 2xx without an id as retry", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(
      (await kindOf(createResendSender({ apiKey: KEY, fetch: down }).send(MESSAGE))).kind,
    ).toBe("retry");
    expect(
      (await kindOf(createResendSender({ apiKey: KEY, fetch: respond(200, {}) }).send(MESSAGE)))
        .kind,
    ).toBe("retry");
  });

  it("never puts the key, the address or the body in a thrown message, even when the provider echoes them", async () => {
    const echo = { message: `bad key ${KEY} for ${MESSAGE.to}` };
    const failing = [
      respond(401, echo),
      respond(500, echo),
      vi.fn(async () => {
        throw new Error(`socket closed, Authorization: Bearer ${KEY}`);
      }),
    ];
    for (const fetchMock of failing) {
      const error = await kindOf(
        createResendSender({ apiKey: KEY, fetch: fetchMock }).send(MESSAGE),
      );
      const seen = `${error.message} ${error.stack ?? ""} ${String(error.cause ?? "")}`;
      expect(seen).not.toContain(KEY);
      expect(seen).not.toContain(MESSAGE.to);
    }
  });

  it("asks fetch for a timeout signal, so a hung provider cannot hold the cron run", async () => {
    const fetchMock = respond(200, { id: "re_1" });
    await createResendSender({ apiKey: KEY, fetch: fetchMock }).send(MESSAGE);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
