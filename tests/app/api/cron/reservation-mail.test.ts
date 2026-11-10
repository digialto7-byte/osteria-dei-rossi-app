import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeResult } from "../../../helpers/fake-supabase";
import { MAIL_BATCH, MAIL_MAX_DURATION_S } from "@/server/reservations/mail/constants";
import { SEND_TIMEOUT_MS } from "@/server/mail/types";
import { verifyCancelToken } from "@/server/reservations/public/tokens";

// Reservations plan §5 B10: the mail cron. The route is the only place where the secret-key client meets the mail sender. Fake data and keys only.
const SECRET = "test-cron-secret-0123456789abcdef0123456789";
const LINK_KEY = "test-link-key-0123456789-abcdefghij";
const reportError = vi.fn();
const admin = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => admin() }));

const route = await import("@/app/api/cron/reservation-mail/route");

const URL_ = "http://localhost:3000/api/cron/reservation-mail";
const post = (authorization?: string) =>
  new Request(URL_, {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
    body: "{}",
  });

const RES_ID = "23000000-0000-4000-8000-000000000001";
const claimRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `24000000-0000-4000-8000-00000000000${n}`,
  kind: "received",
  to: `cliente${n}@example.com`,
  locale: "it",
  name: `Cliente Demo ${n}`,
  venueName: "Osteria Demo A",
  slug: "osteria-demo-a",
  reservationId: RES_ID,
  date: "2026-11-20",
  time: "20:00",
  party: 4,
  serviceName: "Cena",
  cancelExp: 1_794_132_000,
  ...overrides,
});
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string): FakeResult => ({ data: null, error: { code, message: "boom" } });

let fake: ReturnType<typeof fakeSupabase>;
const sent: { to: string; key: string; subject: string; body: string }[] = [];
let sendResults: (Response | Error)[];
const defaultFetch = async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as {
    To: { Email: string }[];
    Subject: string;
    Text: string;
  };
  const next = sendResults.shift() ?? new Response(JSON.stringify({ ID: "mp-1" }), { status: 200 });
  sent.push({ to: body.To[0]!.Email, key: "", subject: body.Subject, body: body.Text });
  if (next instanceof Error) throw next;
  return next;
};
const fetchMock = vi.fn(defaultFetch);

function setup(claim: FakeResult) {
  fake = fakeSupabase({
    rpc: {
      job_run_start: [ok(5)],
      reservation_mail_claim: [claim],
      reservation_mail_finish: [ok({ status: "sent", changed: true })],
    },
  });
  admin.mockReturnValue(fake);
}
const calls = () => fake.rpc.mock.calls.map(([name]) => name as string);
const finishes = () =>
  fake.rpc.mock.calls
    .filter(([name]) => name === "reservation_mail_finish")
    .map(([, args]) => args);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  reportError.mockReset();
  admin.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultFetch);
  sent.length = 0;
  sendResults = [];
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("RESERVATION_LINK_KEY", LINK_KEY);
  vi.stubEnv("RESERVATION_GATE_KEY", "test-gate-key-0123456789-abcdefghij");
  vi.stubEnv("MAIL_TRANSPORT", "mailpit");
  vi.stubEnv("MAIL_FROM", "prenotazioni@example.com");
  vi.stubEnv("MAILPIT_URL", "http://127.0.0.1:54324");
  vi.stubEnv("APP_PUBLIC_ORIGIN", "https://app.example.com");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  setup(ok([]));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("POST /api/cron/reservation-mail authentication", () => {
  it.each([
    ["no header", undefined],
    ["Basic scheme", `Basic ${SECRET}`],
    ["wrong token", "Bearer wrong-token-0123456789abcdef0123456789"],
    ["shorter token", "Bearer short"],
    ["longer token", `Bearer ${SECRET}x`],
  ])("%s -> 401, no RPC, no mail", async (_name, header) => {
    const response = await route.POST(post(header));
    expect(response.status).toBe(401);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(admin).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 405 to GET", async () => {
    const response = await route.POST(new Request(URL_, { method: "GET" }));
    expect(response.status).toBe(405);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when the mail settings are missing, before any claim", async () => {
    vi.stubEnv("MAIL_FROM", "");
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect(calls()).not.toContain("reservation_mail_claim");
    expect((reportError.mock.calls[0]?.[0] as { variables: string[] }).variables).toEqual([
      "MAIL_FROM",
    ]);
  });

  it("refuses the mailpit transport in production, before any claim", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://app.example.com");
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect(calls()).not.toContain("reservation_mail_claim");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/reservation-mail run", () => {
  it("claims with the batch size, then per row: render, send, finish, in that order", async () => {
    setup(ok([claimRow(1), claimRow(2, { kind: "accepted" })]));
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: 2, sent: 2, failed: 0 });
    expect(calls()).toEqual([
      "job_run_start",
      "reservation_mail_claim",
      "reservation_mail_finish",
      "reservation_mail_finish",
      "job_run_finish",
    ]);
    expect(fake.rpc).toHaveBeenCalledWith("reservation_mail_claim", { p_limit: MAIL_BATCH });
    expect(finishes()).toEqual([
      { p_id: claimRow(1).id, p_ok: true, p_provider: "mp-1", p_error: null },
      { p_id: claimRow(2).id, p_ok: true, p_provider: "mp-1", p_error: null },
    ]);
    // Each mail went to its own recipient, with a cancel link whose token verifies.
    expect(sent.map((s) => s.to)).toEqual(["cliente1@example.com", "cliente2@example.com"]);
    const token = /annulla\?t=(\S+)/.exec(sent[0]!.body)![1]!;
    expect(verifyCancelToken({ current: LINK_KEY }, token, 1_794_132_000 - 1)?.reservationId).toBe(
      RES_ID,
    );
  });

  it("interleaves finish with the next send (claim, send, finish, send, finish)", async () => {
    setup(ok([claimRow(1), claimRow(2)]));
    const order: string[] = [];
    fetchMock.mockImplementation(async () => {
      order.push("send");
      return new Response(JSON.stringify({ ID: "mp-1" }), { status: 200 });
    });
    fake.rpc.mockImplementation(((name: string) => {
      order.push(name);
      return Promise.resolve(
        name === "job_run_start"
          ? ok(5)
          : name === "reservation_mail_claim"
            ? ok([claimRow(1), claimRow(2)])
            : ok({ status: "sent", changed: true }),
      );
    }) as never);
    await route.POST(post(`Bearer ${SECRET}`));
    expect(order.slice(1, 6)).toEqual([
      "reservation_mail_claim",
      "send",
      "reservation_mail_finish",
      "send",
      "reservation_mail_finish",
    ]);
  });

  it("one failing send does not stop the others: retry for a 5xx, the rest are sent", async () => {
    setup(ok([claimRow(1), claimRow(2), claimRow(3)]));
    sendResults = [
      new Response("{}", { status: 503 }),
      new Response(JSON.stringify({ ID: "mp-2" }), { status: 200 }),
      new Response(JSON.stringify({ ID: "mp-3" }), { status: 200 }),
    ];
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(await response.json()).toEqual({ handled: 3, sent: 2, failed: 1 });
    expect(finishes()).toEqual([
      { p_id: claimRow(1).id, p_ok: false, p_provider: null, p_error: "retry" },
      { p_id: claimRow(2).id, p_ok: true, p_provider: "mp-2", p_error: null },
      { p_id: claimRow(3).id, p_ok: true, p_provider: "mp-3", p_error: null },
    ]);
  });

  it("finishes a 4xx as rejected and a network failure as retry", async () => {
    setup(ok([claimRow(1), claimRow(2)]));
    sendResults = [new Response("{}", { status: 422 }), new TypeError("fetch failed")];
    await route.POST(post(`Bearer ${SECRET}`));
    expect(finishes().map((f) => (f as { p_error: string }).p_error)).toEqual([
      "rejected",
      "retry",
    ]);
  });

  it("finishes a row the route cannot read as rejected, without a send, and goes on", async () => {
    setup(ok([{ ...claimRow(1), extra: "x" }, claimRow(2), { nonsense: true }]));
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(await response.json()).toEqual({ handled: 3, sent: 1, failed: 2 });
    expect(sent.map((s) => s.to)).toEqual(["cliente2@example.com"]);
    // The unreadable row without an id cannot be finished at all: it only counts.
    expect(finishes()).toEqual([
      { p_id: claimRow(1).id, p_ok: false, p_provider: null, p_error: "rejected" },
      { p_id: claimRow(2).id, p_ok: true, p_provider: "mp-1", p_error: null },
    ]);
  });

  it("a finish that fails is counted and reported by code, and the next row still goes", async () => {
    setup(ok([claimRow(1), claimRow(2)]));
    fake.rpc.mockImplementation(((name: string) =>
      Promise.resolve(
        name === "job_run_start"
          ? ok(5)
          : name === "reservation_mail_claim"
            ? ok([claimRow(1), claimRow(2)])
            : name === "reservation_mail_finish" &&
                fake.rpc.mock.calls.filter(([n]) => n === "reservation_mail_finish").length === 1
              ? failure("57014")
              : ok({ status: "sent", changed: true }),
      )) as never);
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(
      JSON.stringify(reportError.mock.calls.map(([e]) => String((e as Error).message))),
    ).toContain("57014");
  });

  it("an empty claim sends nothing and records items 0", async () => {
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(await response.json()).toEqual({ handled: 0, sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenLastCalledWith("job_run_finish", {
      p_id: 5,
      p_ok: true,
      p_error_code: null,
      p_items: 0,
    });
  });

  it("records the run under the name reservation-mail with items = the rows handled", async () => {
    setup(ok([claimRow(1), claimRow(2)]));
    await route.POST(post(`Bearer ${SECRET}`));
    expect(fake.rpc).toHaveBeenCalledWith("job_run_start", { p_job: "reservation-mail" });
    expect(fake.rpc).toHaveBeenLastCalledWith("job_run_finish", {
      p_id: 5,
      p_ok: true,
      p_error_code: null,
      p_items: 2,
    });
  });

  it("a claim that fails is a 500 naming only the SQLSTATE", async () => {
    setup(failure("42501"));
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect(String((reportError.mock.calls[0]?.[0] as Error).message)).toContain("42501");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a claim that is not an array is a 500", async () => {
    setup(ok({ rows: [] }));
    expect((await route.POST(post(`Bearer ${SECRET}`))).status).toBe(500);
  });

  it("logs row ids and codes only: no address, name, token or key", async () => {
    setup(ok([claimRow(1), claimRow(2)]));
    sendResults = [new Response("{}", { status: 503 })];
    await route.POST(post(`Bearer ${SECRET}`));
    const logged = JSON.stringify([
      warn.mock.calls,
      reportError.mock.calls.map(([e]) => String((e as Error).message)),
    ]);
    expect(logged).toContain(claimRow(1).id);
    for (const secret of ["example.com", "Cliente Demo", LINK_KEY, SECRET, "annulla", "c1."]) {
      expect(logged, secret).not.toContain(secret);
    }
  });

  it("the secret-key client is only ever given to the claim and the finish", async () => {
    setup(ok([claimRow(1)]));
    await route.POST(post(`Bearer ${SECRET}`));
    expect(new Set(calls())).toEqual(
      new Set([
        "job_run_start",
        "reservation_mail_claim",
        "reservation_mail_finish",
        "job_run_finish",
      ]),
    );
  });
});

describe("time limits", () => {
  it("the route exports POST and maxDuration only, and a full batch of slow sends fits inside maxDuration", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration"]);
    expect(route.maxDuration).toBe(MAIL_MAX_DURATION_S);
    expect(MAIL_BATCH * SEND_TIMEOUT_MS).toBeLessThan(MAIL_MAX_DURATION_S * 1000);
  });
});
