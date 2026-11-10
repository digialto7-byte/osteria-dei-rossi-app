import { describe, expect, it, vi } from "vitest";
import { createMailSender } from "@/server/mail";
import { createMailpitSender } from "@/server/mail/mailpit";
import { MailError, type MailMessage } from "@/server/mail/types";
import type { MailEnv } from "@/lib/env";

// Reservations plan §5 B9 (T-R1): the dev and test sink is Mailpit's JSON send API.
const MESSAGE: MailMessage = {
  to: "cliente.demo@example.com",
  from: "Osteria Demo <prenotazioni@example.com>",
  subject: "Prova",
  text: "Ciao",
  html: "<p>Ciao</p>",
  idempotencyKey: "24000000-0000-4000-8000-0000000000aa",
};
const respond = (status: number, body: unknown = {}) =>
  vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body), { status }));

describe("createMailpitSender", () => {
  it("posts Mailpit's JSON shape to <MAILPIT_URL>/api/v1/send", async () => {
    const fetchMock = respond(200, { ID: "abc" });
    const result = await createMailpitSender({
      url: "http://127.0.0.1:54324",
      fetch: fetchMock,
    }).send(MESSAGE);
    expect(result).toEqual({ providerId: "abc" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:54324/api/v1/send");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      From: { Email: "prenotazioni@example.com", Name: "Osteria Demo" },
      To: [{ Email: MESSAGE.to }],
      Subject: MESSAGE.subject,
      Text: MESSAGE.text,
      HTML: MESSAGE.html,
    });
  });

  it("accepts a bare sender address", async () => {
    const fetchMock = respond(200, { ID: "abc" });
    await createMailpitSender({ url: "http://127.0.0.1:54324", fetch: fetchMock }).send({
      ...MESSAGE,
      from: "prenotazioni@example.com",
    });
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string).From).toEqual({
      Email: "prenotazioni@example.com",
    });
  });

  it("maps 5xx and a network failure to retry, other 4xx to rejected", async () => {
    const run = async (fetchMock: typeof fetch) => {
      try {
        await createMailpitSender({ url: "http://127.0.0.1:54324", fetch: fetchMock }).send(
          MESSAGE,
        );
      } catch (error) {
        return (error as MailError).kind;
      }
      return "sent";
    };
    expect(await run(respond(503) as unknown as typeof fetch)).toBe("retry");
    expect(await run(respond(400) as unknown as typeof fetch)).toBe("rejected");
    expect(
      await run((async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch),
    ).toBe("retry");
  });
});

describe("createMailSender", () => {
  const base: MailEnv = {
    transport: "mailpit",
    from: "prenotazioni@example.com",
    appPublicOrigin: "http://localhost:3000",
    resendApiKey: undefined,
    mailpitUrl: "http://127.0.0.1:54324",
  };

  it("picks Mailpit for MAIL_TRANSPORT=mailpit and Resend for resend", async () => {
    const fetchMock = respond(200, { ID: "x", id: "y" });
    await createMailSender(base, fetchMock as unknown as typeof fetch).send(MESSAGE);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:54324/api/v1/send");
    await createMailSender(
      { ...base, transport: "resend", resendApiKey: "test-key" },
      fetchMock as unknown as typeof fetch,
    ).send(MESSAGE);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.resend.com/emails");
  });
});
