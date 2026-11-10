import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { GATE_KEY, LINK_KEY, NOW_MS, SLUG } from "../../helpers/reservations-public-data";
import { gateMac } from "@/server/reservations/public/gate";
import { keyId, signCancelToken } from "@/server/reservations/public/tokens";

// Reservations plan §5 B8: the public cancel API. A GET never writes; every bad link is the same 404 and costs no RPC.
let anon: FakeSupabase;
let staff: FakeSupabase;
vi.mock("@/lib/supabase/anon", () => ({ createSupabaseAnonClient: () => anon }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => staff }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/public/reservations/[slug]/cancel/route");

const ORIGIN = "http://localhost:3000";
const BASE = `${ORIGIN}/api/public/reservations/${SLUG}/cancel`;
const ID = "23000000-0000-4000-8000-000000000001";
const NOW_S = Math.floor(NOW_MS / 1000);
const EXP = NOW_S + 3600;
const keys = { current: LINK_KEY };
const TOKEN = signCancelToken(keys, ID, EXP);
const VIEW = {
  date: "2026-11-27",
  time: "20:00",
  party: 4,
  serviceName: "Cena",
  status: "accepted",
  canCancel: true,
};

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message, details: null },
});
function use(rpc: Record<string, FakeResult[]>) {
  anon = fakeSupabase({ rpc });
  staff = fakeSupabase({ claims: claimsFor("owner") });
}
const ctx = (slug = SLUG) => routeContext({ slug });
const get = (token: string | null, slug = SLUG) =>
  route.GET(
    new Request(token === null ? BASE : `${BASE}?t=${encodeURIComponent(token)}`),
    ctx(slug),
  );
const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(
    jsonRequest(BASE, body, {
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    }),
    ctx(),
  );
const bodyOf = async (response: Response) => (await response.json()) as { error: { code: string } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  vi.stubEnv("RESERVATION_GATE_KEY", GATE_KEY);
  vi.stubEnv("RESERVATION_LINK_KEY", LINK_KEY);
  reportError.mockReset();
  use({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const BAD_TOKENS: [string, () => string][] = [
  ["garbage", () => "garbage"],
  ["empty", () => ""],
  [
    "a flipped MAC",
    () => {
      const parts = TOKEN.split(".");
      const mac = parts[4]!;
      return [...parts.slice(0, 4), (mac[0] === "a" ? "b" : "a") + mac.slice(1)].join(".");
    },
  ],
  ["a wrong kid", () => TOKEN.replace(`.${keyId(LINK_KEY)}.`, ".00000000.")],
  ["an expired token", () => signCancelToken(keys, ID, NOW_S)],
  ["a token of another key", () => signCancelToken({ current: "x".repeat(40) }, ID, EXP)],
];

describe("GET /api/public/reservations/:slug/cancel", () => {
  it("calls reservation_cancel_view with the gate, the id and exp from the token, and only that", async () => {
    use({ reservation_cancel_view: [ok(VIEW)] });
    const response = await get(TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VIEW);
    expect(anon.rpc).toHaveBeenCalledTimes(1);
    expect(anon.rpc).toHaveBeenCalledWith("reservation_cancel_view", {
      p_slug: SLUG,
      p_gate_ts: NOW_S,
      p_gate_mac: gateMac(GATE_KEY, "reservation_cancel_view", SLUG, NOW_S),
      p_reservation: ID,
      p_exp: EXP,
    });
    expect(staff.rpc).not.toHaveBeenCalled();
  });

  it("never writes: no cancel_reservation call, whatever the token", async () => {
    use({
      reservation_cancel_view: [ok(VIEW)],
      cancel_reservation: [ok({ status: "cancelled", already: false })],
    });
    await get(TOKEN);
    await get("garbage");
    const names = anon.rpc.mock.calls.map(([name]) => name);
    expect(names).not.toContain("cancel_reservation");
    expect(anon.from).not.toHaveBeenCalled();
  });

  it.each(BAD_TOKENS)(
    "answers 404 link_invalid with no RPC for %s, with one identical body",
    async (_name, make) => {
      const response = await get(make());
      expect(response.status).toBe(404);
      expect((await bodyOf(response)).error.code).toBe("link_invalid");
      expect(anon.rpc).not.toHaveBeenCalled();
      expect(await (await get(make())).json()).toEqual(await (await get("garbage")).json());
    },
  );

  it("answers the same 404 for a missing ?t=, and for an unknown t parameter", async () => {
    expect((await bodyOf(await get(null))).error.code).toBe("link_invalid");
    const response = await route.GET(new Request(`${BASE}?t=${TOKEN}&x=1`), ctx());
    expect(response.status).toBe(404);
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("answers the same 404 link_invalid when the database does not know the booking or the slug does not match (not_found)", async () => {
    use({ reservation_cancel_view: [failure("P0002", "not_found")] });
    const response = await get(TOKEN);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(await (await get("garbage")).json());
  });

  it("passes canCancel false through for a declined booking", async () => {
    use({ reservation_cancel_view: [ok({ ...VIEW, status: "declined", canCancel: false })] });
    expect(await (await get(TOKEN)).json()).toMatchObject({ status: "declined", canCancel: false });
  });

  it("answers 500 for a reply with a name, phone or e-mail key", async () => {
    use({ reservation_cancel_view: [ok({ ...VIEW, name: "Cliente Demo" })] });
    const response = await get(TOKEN);
    expect(response.status).toBe(500);
    expect(
      JSON.stringify([
        await response.text(),
        reportError.mock.calls.map(([e]) => String((e as Error).message)),
      ]),
    ).not.toContain("Cliente Demo");
  });

  it("is noindex and no-store on success and on error", async () => {
    use({ reservation_cancel_view: [ok(VIEW)] });
    for (const response of [await get(TOKEN), await get("garbage")]) {
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("POST /api/public/reservations/:slug/cancel", () => {
  it("calls cancel_reservation with the gate, the id and exp, and passes already through", async () => {
    use({
      cancel_reservation: [
        ok({ status: "cancelled", already: false }),
        ok({ status: "cancelled", already: true }),
      ],
    });
    const first = await post({ token: TOKEN });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "cancelled", already: false });
    expect(anon.rpc).toHaveBeenCalledWith("cancel_reservation", {
      p_slug: SLUG,
      p_gate_ts: NOW_S,
      p_gate_mac: gateMac(GATE_KEY, "cancel_reservation", SLUG, NOW_S),
      p_reservation: ID,
      p_exp: EXP,
    });
    expect(await (await post({ token: TOKEN })).json()).toEqual({
      status: "cancelled",
      already: true,
    });
  });

  it.each(BAD_TOKENS)("answers 404 link_invalid with no RPC for %s", async (_name, make) => {
    const response = await post({ token: make() });
    expect(response.status).toBe(404);
    expect((await bodyOf(response)).error.code).toBe("link_invalid");
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing or foreign Origin with 403 and no RPC", async () => {
    for (const origin of [undefined, "https://evil.example.com"]) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const response = await route.POST(
        new Request(BASE, { method: "POST", headers, body: JSON.stringify({ token: TOKEN }) }),
        ctx(),
      );
      expect(response.status).toBe(403);
    }
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("answers 415 for non-JSON, 400 for a body with another key or no token", async () => {
    expect((await post("x", { "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ token: TOKEN, extra: 1 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(anon.rpc).not.toHaveBeenCalled();
  });

  it("maps cancel_closed and status_invalid to 409, and not_found to the same 404 link_invalid", async () => {
    use({ cancel_reservation: [failure("P0001", "cancel_closed")] });
    const closed = await post({ token: TOKEN });
    expect(closed.status).toBe(409);
    expect((await bodyOf(closed)).error.code).toBe("cancel_closed");
    use({ cancel_reservation: [failure("P0001", "status_invalid")] });
    expect((await post({ token: TOKEN })).status).toBe(409);
    use({ cancel_reservation: [failure("P0002", "not_found")] });
    const missing = await post({ token: TOKEN });
    expect(missing.status).toBe(404);
    expect((await bodyOf(missing)).error.code).toBe("link_invalid");
  });

  it("maps a gate refusal to 503 and reports a code only", async () => {
    use({ cancel_reservation: [failure("P0001", "gate_invalid")] });
    expect((await post({ token: TOKEN })).status).toBe(503);
    expect(String((reportError.mock.calls[0]?.[0] as Error).message)).toBe(
      "reservation_gate_invalid",
    );
  });

  it("is noindex on success and on error", async () => {
    use({ cancel_reservation: [ok({ status: "cancelled", already: false })] });
    expect((await post({ token: TOKEN })).headers.get("x-robots-tag")).toBe("noindex");
    expect((await post({ token: "garbage" })).headers.get("x-robots-tag")).toBe("noindex");
    expect((await post("x", { "content-type": "text/plain" })).headers.get("x-robots-tag")).toBe(
      "noindex",
    );
  });
});
