import { describe, expect, it, vi } from "vitest";
import { cancelLinkFrom, waitForMail } from "./reservation-mail";

const TOKEN =
  "c1.8c8fecc4.23000000-0000-4000-8000-000000000001.1794132000.43024b91ef9e5cef6df3bdc4337b5b3abb011dfebc2490db058fc107eb7dbd61";

describe("cancelLinkFrom", () => {
  it("finds the cancel URL and its token in the text of an e-mail", () => {
    const text = `Ciao\n\nSe non puoi più venire, annulla:\nhttp://localhost:3000/prenota/osteria-demo-a/annulla?t=${TOKEN}\n\n--\nfine\n`;
    expect(cancelLinkFrom(text)).toEqual({
      url: `http://localhost:3000/prenota/osteria-demo-a/annulla?t=${TOKEN}`,
      slug: "osteria-demo-a",
      token: TOKEN,
    });
  });

  it("is null when there is no cancel link (the declined e-mail)", () => {
    expect(cancelLinkFrom("Ci dispiace.\nhttp://localhost:3000/prenota/osteria-demo-a")).toBeNull();
  });
});

describe("waitForMail", () => {
  const list = (messages: unknown[]) => ({ ok: true, json: async () => ({ messages }) });
  const one = (subject: string) => ({
    ID: "m1",
    Subject: subject,
    To: [{ Address: "cliente.demo@example.com" }],
  });

  it("returns the text of the newest matching message to the address", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/api/v1/messages")
        ? list([one("Altro"), one("Prenotazione confermata - Osteria Demo A")])
        : { ok: true, json: async () => ({ Text: "testo" }) },
    );
    const found = await waitForMail("http://127.0.0.1:54324", "CLIENTE.demo@example.com", {
      subject: /confermata/,
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 1000,
    });
    expect(found).toEqual({
      id: "m1",
      subject: "Prenotazione confermata - Osteria Demo A",
      text: "testo",
    });
  });

  it("throws, naming the address but no message text, when nothing matches in time", async () => {
    const fetchMock = vi.fn(async () => list([one("Altro")]));
    await expect(
      waitForMail("http://127.0.0.1:54324", "cliente.demo@example.com", {
        subject: /confermata/,
        fetch: fetchMock as unknown as typeof fetch,
        timeoutMs: 50,
        intervalMs: 10,
      }),
    ).rejects.toThrow(/cliente\.demo@example\.com/);
  });
});
