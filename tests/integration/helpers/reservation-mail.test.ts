import { describe, expect, it, vi } from "vitest";
import { cancelLinkFrom, drainMailJob, waitForMail } from "./reservation-mail";

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

  it("gives up on a request that never answers (its own timeout) and still ends at the deadline", async () => {
    // A fetch that only ends when its signal aborts: without a per-request timeout this would hang for ever.
    const hanging = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const started = Date.now();
    await expect(
      waitForMail("http://127.0.0.1:54324", "cliente.demo@example.com", {
        subject: /confermata/,
        fetch: hanging as unknown as typeof fetch,
        timeoutMs: 300,
        requestTimeoutMs: 50,
        intervalMs: 10,
      }),
    ).rejects.toThrow(/cliente\.demo@example\.com/);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(hanging.mock.calls.length).toBeGreaterThan(1);
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

describe("drainMailJob", () => {
  const round = (handled: number, sent = handled, failed = 0) => ({ handled, sent, failed });

  it("runs the job until it handles nothing and adds the rounds up", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(round(10))
      .mockResolvedValueOnce(round(4, 3, 1))
      .mockResolvedValueOnce(round(0));
    expect(await drainMailJob(run)).toEqual({ handled: 14, sent: 13, failed: 1, rounds: 3 });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops after one run when nothing was due", async () => {
    const run = vi.fn().mockResolvedValue(round(0));
    expect(await drainMailJob(run)).toEqual({ handled: 0, sent: 0, failed: 0, rounds: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded number of rounds (10 by default, or the one given)", async () => {
    const run = vi.fn().mockResolvedValue(round(10));
    expect((await drainMailJob(run)).rounds).toBe(10);
    expect(run).toHaveBeenCalledTimes(10);
    const few = vi.fn().mockResolvedValue(round(1));
    expect((await drainMailJob(few, 3)).rounds).toBe(3);
    expect(few).toHaveBeenCalledTimes(3);
  });

  it("fails, saying how far it got, when the time budget is spent between rounds", async () => {
    let clock = 0;
    const run = vi.fn(async () => {
      clock += 40_000;
      return round(10);
    });
    await expect(drainMailJob(run, 10, { budgetMs: 100_000, now: () => clock })).rejects.toThrow(
      /over budget after 3 rounds.*handled 30/,
    );
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not trip the budget when it finishes inside it", async () => {
    const run = vi.fn().mockResolvedValueOnce(round(2)).mockResolvedValueOnce(round(0));
    expect(await drainMailJob(run, 10, { budgetMs: 1000, now: () => 0 })).toMatchObject({
      rounds: 2,
    });
  });

  it("lets an error from a run through", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(drainMailJob(run)).rejects.toThrow("boom");
  });
});
