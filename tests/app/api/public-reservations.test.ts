import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  FAKE_CUSTOMER,
  GATE_KEY,
  LINK_KEY,
  NOW_MS,
  PAGE_REPLY,
  requestBody,
  SLOTS_REPLY,
  SLUG,
} from "../../helpers/reservations-public-data";
import { isMessageKey } from "@/lib/i18n";
import { REQUEST_INVALID_REASONS, SLOT_UNAVAILABLE_REASONS } from "@/server/reservations/constants";
import { RESERVATION_NOTICE_VERSION } from "@/server/reservations/constants";
import { gateMac } from "@/server/reservations/public/gate";
import { checkFormToken } from "@/server/reservations/public/tokens";

// Reservations plan §5 B7: the public request API. The anon client is replaced by a recording fake; the staff (cookie) client is a second fake that must stay untouched.
let anon: FakeSupabase;
let staff: FakeSupabase;
const createAnon = vi.fn();
vi.mock("@/lib/supabase/anon", () => ({
  createSupabaseAnonClient: () => {
    createAnon();
    return anon;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => staff }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const pageRoute = await import("@/app/api/public/reservations/[slug]/page/route");
const slotsRoute = await import("@/app/api/public/reservations/[slug]/slots/route");
const requestsRoute = await import("@/app/api/public/reservations/[slug]/requests/route");

const ORIGIN = "http://localhost:3000";
const BASE = `${ORIGIN}/api/public/reservations/${SLUG}`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details: details ?? null },
});

function use(rpc: Record<string, FakeResult[]>) {
  anon = fakeSupabase({ rpc });
  // A signed-in staff cookie is on every request: nothing may use it.
  staff = fakeSupabase({ claims: claimsFor("owner") });
}
const ctx = (slug = SLUG) => routeContext({ slug });
const post = (body: unknown, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  jsonRequest(`${BASE}/requests`, body, {
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: "sb-staff-auth-token=staff-session",
      // Vercel always sets it; the database refuses a request with no address.
      "x-forwarded-for": FAKE_CUSTOMER.ip,
      ...headers,
    },
    ...init,
  });
const error = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string; details?: unknown } })
    .error;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  vi.stubEnv("RESERVATION_GATE_KEY", GATE_KEY);
  vi.stubEnv("RESERVATION_LINK_KEY", LINK_KEY);
  reportError.mockReset();
  createAnon.mockReset();
  use({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/public/reservations/:slug/page", () => {
  const get = () => new Request(`${BASE}/page`, { headers: { cookie: "sb-staff-auth-token=x" } });

  it("calls reservation_page with the gate for this function, slug and second, then adds the form token and the notice version", async () => {
    use({ reservation_page: [ok(PAGE_REPLY)] });
    const response = await pageRoute.GET(get(), ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const ts = Math.floor(NOW_MS / 1000);
    expect(anon.rpc).toHaveBeenCalledWith("reservation_page", {
      p_slug: SLUG,
      p_gate_ts: ts,
      p_gate_mac: gateMac(GATE_KEY, "reservation_page", SLUG, ts),
    });
    const body = (await response.json()) as typeof PAGE_REPLY & {
      formToken: string;
      privacy: { noticeVersion: string };
    };
    expect(body.venueName).toBe("Osteria Demo A");
    expect(body.privacy).toEqual({
      ...PAGE_REPLY.privacy,
      noticeVersion: RESERVATION_NOTICE_VERSION,
    });
    // The token is bound to the slug and opens after the minimum fill time.
    const keys = { current: LINK_KEY };
    expect(checkFormToken(keys, SLUG, body.formToken, NOW_MS)).toBe("too_fast");
    expect(checkFormToken(keys, SLUG, body.formToken, NOW_MS + 3000)).toBe("ok");
    expect(checkFormToken(keys, "osteria-demo-b", body.formToken, NOW_MS + 3000)).toBe("invalid");
  });

  it("uses the anon client only: a staff cookie is ignored and the cookie client is never touched", async () => {
    use({ reservation_page: [ok(PAGE_REPLY)] });
    await pageRoute.GET(get(), ctx());
    expect(createAnon).toHaveBeenCalledTimes(1);
    expect(staff.rpc).not.toHaveBeenCalled();
    expect(staff.from).not.toHaveBeenCalled();
    expect(staff.auth.getClaims).not.toHaveBeenCalled();
  });

  it("answers 404 before any RPC for a malformed slug", async () => {
    for (const slug of ["A", "Osteria Demo", "-bad-", "x".repeat(41), "a_b"]) {
      const response = await pageRoute.GET(get(), ctx(slug));
      expect(response.status, slug).toBe(404);
    }
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("answers the same 404 for an unknown, a disabled and a not-ready slug", async () => {
    // The database raises one P0002 not_found for all three.
    use({ reservation_page: [failure("P0002", "not_found")] });
    const first = await pageRoute.GET(get(), ctx("osteria-demo-z"));
    const second = await pageRoute.GET(get(), ctx("osteria-demo-off"));
    expect(first.status).toBe(404);
    expect(await first.json()).toEqual(await second.json());
    expect((await error(await pageRoute.GET(get(), ctx()))).code).toBe("not_found");
  });

  it("answers 503 reservations_unconfigured for a missing Vault secret, and for a gate the database refuses (a key mismatch)", async () => {
    use({ reservation_page: [failure("P0001", "reservations_unconfigured")] });
    const first = await pageRoute.GET(get(), ctx());
    expect(first.status).toBe(503);
    expect((await error(first)).code).toBe("reservations_unconfigured");
    use({ reservation_page: [failure("P0001", "gate_invalid")] });
    const second = await pageRoute.GET(get(), ctx());
    expect(second.status).toBe(503);
    // A mismatch between the Vercel key and the Vault key must be visible to the operator: one report, a code only.
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String((reportError.mock.calls[0]?.[0] as Error).message)).toBe(
      "reservation_gate_invalid",
    );
  });

  it("answers 503 and reports the variable names when the keys are not configured", async () => {
    vi.stubEnv("RESERVATION_GATE_KEY", "");
    const response = await pageRoute.GET(get(), ctx());
    expect(response.status).toBe(503);
    expect(anon.rpc).not.toHaveBeenCalled();
    expect((reportError.mock.calls[0]?.[0] as { variables: string[] }).variables).toEqual([
      "RESERVATION_GATE_KEY",
    ]);
  });

  it("answers 500 when the reply has a key the schema does not know", async () => {
    use({ reservation_page: [ok({ ...PAGE_REPLY, tablesFree: 3 })] });
    expect((await pageRoute.GET(get(), ctx())).status).toBe(500);
  });
});

describe("GET /api/public/reservations/:slug/slots", () => {
  const get = (query: string) => new Request(`${BASE}/slots${query}`);

  it("calls reservation_slots with the date and party and returns slots without counts", async () => {
    use({ reservation_slots: [ok(SLOTS_REPLY)] });
    const response = await slotsRoute.GET(get("?date=2026-11-27&party=4"), ctx());
    expect(response.status).toBe(200);
    const ts = Math.floor(NOW_MS / 1000);
    expect(anon.rpc).toHaveBeenCalledWith("reservation_slots", {
      p_slug: SLUG,
      p_gate_ts: ts,
      p_gate_mac: gateMac(GATE_KEY, "reservation_slots", SLUG, ts),
      p_date: "2026-11-27",
      p_party: 4,
    });
    expect(await response.json()).toEqual(SLOTS_REPLY);
  });

  it.each([
    "",
    "?date=2026-11-27",
    "?party=4",
    "?date=2026-13-01&party=4",
    "?date=27-11-2026&party=4",
    "?date=2026-11-27&party=0",
    "?date=2026-11-27&party=100",
    "?date=2026-11-27&party=2.5",
    "?date=2026-11-27&party=abc",
    "?date=2026-11-27&party=4&extra=1",
    "?date=2026-11-27&date=2026-11-28&party=4",
  ])("answers 400 with no RPC for the query %j", async (query) => {
    expect((await slotsRoute.GET(get(query), ctx())).status).toBe(400);
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed slug without an RPC, and for an unknown one", async () => {
    expect((await slotsRoute.GET(get("?date=2026-11-27&party=4"), ctx("X"))).status).toBe(404);
    expect(anon.rpc).not.toHaveBeenCalled();
    use({ reservation_slots: [failure("P0002", "not_found")] });
    expect((await slotsRoute.GET(get("?date=2026-11-27&party=4"), ctx())).status).toBe(404);
  });

  it("maps request_invalid to 400 and a reply with a count to 500", async () => {
    use({ reservation_slots: [failure("P0001", "request_invalid", '{"reason":"date"}')] });
    const response = await slotsRoute.GET(get("?date=2026-11-27&party=4"), ctx());
    expect(response.status).toBe(400);
    expect((await error(response)).details).toEqual({ reason: "date" });
    use({
      reservation_slots: [
        ok({
          ...SLOTS_REPLY,
          services: [
            { key: "cena", name: "Cena", slots: [{ time: "19:00", available: true, left: 2 }] },
          ],
        }),
      ],
    });
    expect((await slotsRoute.GET(get("?date=2026-11-27&party=4"), ctx())).status).toBe(500);
  });
});

describe("POST /api/public/reservations/:slug/requests", () => {
  const received = { status: "received" };

  it("sends exactly the nine keys the database expects, the gate, and the first x-forwarded-for entry as the IP", async () => {
    use({ request_reservation: [ok(received)] });
    const response = await requestsRoute.POST(
      post(requestBody(), { "x-forwarded-for": `${FAKE_CUSTOMER.ip}, 198.51.100.1` }),
      ctx(),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(received);
    const ts = Math.floor(NOW_MS / 1000);
    expect(anon.rpc).toHaveBeenCalledTimes(1);
    expect(anon.rpc).toHaveBeenCalledWith("request_reservation", {
      p_slug: SLUG,
      p_gate_ts: ts,
      p_gate_mac: gateMac(GATE_KEY, "request_reservation", SLUG, ts),
      p_body: {
        date: "2026-11-27",
        serviceKey: "cena",
        time: "20:00",
        party: 4,
        name: FAKE_CUSTOMER.name,
        phone: FAKE_CUSTOMER.phone,
        email: FAKE_CUSTOMER.email,
        locale: "it",
        privacyNoticeVersion: RESERVATION_NOTICE_VERSION,
      },
      p_ip: FAKE_CUSTOMER.ip,
    });
    expect(staff.rpc).not.toHaveBeenCalled();
  });

  it("refuses a request with no client address (no x-forwarded-for, or a blank one): the database would refuse it too, so there is no RPC", async () => {
    for (const headers of [
      { "x-forwarded-for": "" },
      { "x-forwarded-for": " " },
      { "x-forwarded-for": ", 198.51.100.1" },
    ]) {
      use({ request_reservation: [ok(received)] });
      const response = await requestsRoute.POST(post(requestBody(), headers), ctx());
      expect(response.status).toBe(400);
      expect((await error(response)).code).toBe("invalid_request");
      expect(anon.rpc).not.toHaveBeenCalled();
    }
  });

  it("refuses a missing, foreign or malformed Origin with 403 and no RPC", async () => {
    for (const origin of [undefined, "https://evil.example.com", "null", ORIGIN + ".evil.com"]) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const response = await requestsRoute.POST(
        new Request(`${BASE}/requests`, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody()),
        }),
        ctx(),
      );
      expect(response.status, String(origin)).toBe(403);
      expect((await error(response)).code).toBe("invalid_origin");
    }
    expect(anon.rpc).not.toHaveBeenCalled();
    expect(createAnon).not.toHaveBeenCalled();
  });

  it("checks the Origin before the body: a foreign Origin with a broken body is still 403", async () => {
    const response = await requestsRoute.POST(
      post("{not json", { origin: "https://evil.example.com" }),
      ctx(),
    );
    expect(response.status).toBe(403);
  });

  it("answers 415 for a non-JSON body, 400 for broken JSON", async () => {
    expect(
      (await requestsRoute.POST(post("x", { "content-type": "text/plain" }), ctx())).status,
    ).toBe(415);
    const response = await requestsRoute.POST(post("{not json"), ctx());
    expect(response.status).toBe(400);
    expect((await error(response)).code).toBe("invalid_json");
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("answers 413 for 5 KB, declared or not", async () => {
    const big = requestBody({ name: "x".repeat(5 * 1024) });
    const declared = await requestsRoute.POST(post(big), ctx());
    expect(declared.status).toBe(413);
    // A stream has no Content-Length: the size is counted on the bytes read.
    const text = JSON.stringify(big);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    const undeclared = await requestsRoute.POST(
      new Request(`${BASE}/requests`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: stream,
        duplex: "half",
      } as RequestInit),
      ctx(),
    );
    expect(undeclared.status).toBe(413);
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("accepts a body just under the 4 KB limit", async () => {
    use({ request_reservation: [ok(received)] });
    const text = JSON.stringify(requestBody());
    expect(Buffer.byteLength(text)).toBeLessThan(4096);
    expect((await requestsRoute.POST(post(text), ctx())).status).toBe(202);
  });

  it("answers 202 and makes no RPC when the honeypot is filled, even with a bad form token", async () => {
    const response = await requestsRoute.POST(
      post(requestBody({ website: "http://spam.example.com", formToken: "garbage" })),
      ctx(),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(received);
    expect(anon.rpc).not.toHaveBeenCalled();
    expect(createAnon).not.toHaveBeenCalled();
  });

  it.each([
    ["privacyAck false", { privacyAck: false }],
    ["privacyAck missing", { privacyAck: undefined }],
    ["an unknown key", { table: "T1" }],
    ["party 0", { party: 0 }],
    ["party 100", { party: 100 }],
    ["a bad date", { date: "2026-02-30" }],
    ["a bad time", { time: "25:00" }],
    ["a bad service key", { serviceKey: "Cena!" }],
    ["an empty name", { name: "  " }],
    ["a name over 80", { name: "x".repeat(81) }],
    ["a bad e-mail", { email: "not-an-email" }],
    ["a bad phone", { phone: "abc" }],
    ["a bad locale", { locale: "fr" }],
    ["a long website", { website: "x".repeat(201) }],
  ])("answers 400 with no RPC for %s", async (_name, overrides) => {
    const response = await requestsRoute.POST(post(requestBody(overrides)), ctx());
    expect(response.status).toBe(400);
    expect((await error(response)).code).toBe("invalid_request");
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("names invalid fields but never echoes a value", async () => {
    const response = await requestsRoute.POST(post(requestBody({ email: "secret@bad" })), ctx());
    const body = JSON.stringify(await response.json());
    expect(body).toContain("email");
    expect(body).not.toContain("secret@bad");
  });

  it("answers 422 form_too_fast under 3 s and form_expired after 2 h, with no RPC", async () => {
    const fast = await requestsRoute.POST(post(requestBody({}, 2999)), ctx());
    expect(fast.status).toBe(422);
    expect((await error(fast)).code).toBe("form_too_fast");
    const slow = await requestsRoute.POST(post(requestBody({}, 2 * 3600 * 1000 + 1)), ctx());
    expect(slow.status).toBe(422);
    expect((await error(slow)).code).toBe("form_expired");
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("answers 422 form_invalid for a garbage token and for a token of another page", async () => {
    const garbage = await requestsRoute.POST(post(requestBody({ formToken: "garbage" })), ctx());
    expect(garbage.status).toBe(422);
    expect((await error(garbage)).code).toBe("form_invalid");
    const other = await requestsRoute.POST(post(requestBody()), ctx("osteria-demo-b"));
    expect((await error(other)).code).toBe("form_invalid");
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed slug before anything else", async () => {
    expect((await requestsRoute.POST(post(requestBody()), ctx("A"))).status).toBe(404);
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("maps rate_limited to 429", async () => {
    use({ request_reservation: [failure("P0001", "rate_limited")] });
    const response = await requestsRoute.POST(post(requestBody()), ctx());
    expect(response.status).toBe(429);
    expect((await error(response)).code).toBe("rate_limited");
  });

  it.each(SLOT_UNAVAILABLE_REASONS)(
    "maps slot_unavailable %s to 422 with its reason and an it and en message",
    async (reason) => {
      use({
        request_reservation: [failure("P0001", "slot_unavailable", JSON.stringify({ reason }))],
      });
      const response = await requestsRoute.POST(post(requestBody()), ctx());
      expect(response.status).toBe(422);
      const body = await error(response);
      expect(body.code).toBe("slot_unavailable");
      expect(body.details).toEqual({ reason });
      expect(isMessageKey(`publicReservationError.slot.${reason}`)).toBe(true);
      // The customer's message never names a table (customers never see tables).
      expect(body.message).not.toMatch(/tavol|table/i);
    },
  );

  it.each(REQUEST_INVALID_REASONS)(
    "maps request_invalid %s to 400 with the field",
    async (reason) => {
      use({
        request_reservation: [failure("P0001", "request_invalid", JSON.stringify({ reason }))],
      });
      const response = await requestsRoute.POST(post(requestBody()), ctx());
      expect(response.status).toBe(400);
      expect((await error(response)).details).toEqual({ reason });
    },
  );

  it("maps not_found to 404, reservations_unconfigured to 503 and 22023 to 400", async () => {
    use({ request_reservation: [failure("P0002", "not_found")] });
    expect((await requestsRoute.POST(post(requestBody()), ctx())).status).toBe(404);
    use({ request_reservation: [failure("P0001", "reservations_unconfigured")] });
    expect((await requestsRoute.POST(post(requestBody()), ctx())).status).toBe(503);
    use({ request_reservation: [failure("22023", "invalid_request")] });
    expect((await requestsRoute.POST(post(requestBody()), ctx())).status).toBe(400);
  });

  it("answers 500 for any other database error, naming only the SQLSTATE", async () => {
    use({ request_reservation: [failure("XX000", `boom ${FAKE_CUSTOMER.email}`)] });
    const response = await requestsRoute.POST(post(requestBody()), ctx());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(FAKE_CUSTOMER.email);
  });

  it("never lets the name, phone, e-mail or IP reach the error reporter or a response", async () => {
    const pii = [FAKE_CUSTOMER.name, FAKE_CUSTOMER.phone, FAKE_CUSTOMER.email, FAKE_CUSTOMER.ip];
    const scenarios: FakeResult[] = [
      failure("XX000", `boom ${pii.join(" ")}`),
      failure("P0001", "gate_invalid", pii.join(" ")),
      ok({ status: "received", echo: pii.join(" ") }),
      ok({ status: "weird" }),
    ];
    for (const scenario of scenarios) {
      use({ request_reservation: [scenario] });
      const response = await requestsRoute.POST(
        post(requestBody(), { "x-forwarded-for": FAKE_CUSTOMER.ip }),
        ctx(),
      );
      const seen = JSON.stringify([
        await response.text(),
        reportError.mock.calls.map(([e]) => [
          String((e as Error).message),
          (e as Error).stack?.split("\n")[0],
        ]),
      ]);
      for (const value of pii) expect(seen).not.toContain(value);
    }
    expect(reportError).toHaveBeenCalled();
  });

  it("answers 500 for a reply that is not {status: received}", async () => {
    use({ request_reservation: [ok({ status: "received", id: "x" })] });
    expect((await requestsRoute.POST(post(requestBody()), ctx())).status).toBe(500);
  });

  it("sets no-store", async () => {
    use({ request_reservation: [ok(received)] });
    expect(
      (await requestsRoute.POST(post(requestBody()), ctx())).headers.get("cache-control"),
    ).toBe("no-store");
  });
});
