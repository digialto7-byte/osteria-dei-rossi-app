import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  GATE_KEY,
  LINK_KEY,
  NOW_MS,
  PAGE_REPLY,
  requestBody,
  SLOTS_REPLY,
  SLUG,
} from "../../helpers/reservations-public-data";
import { GATE_FUNCTIONS, gateMac } from "@/server/reservations/public/gate";
import { signCancelToken } from "@/server/reservations/public/tokens";

// The gate MAC binds only the function, the slug and the second: not the body, not the IP. Whoever sees one can replay it for a minute, so it must never leave the
// server (lead read of #69). Every answer of the public routes (success and error, body and headers) is searched for the name of the argument and for the value the
// test key computes; a static scan is the second layer.
let anon: FakeSupabase;
vi.mock("@/lib/supabase/anon", () => ({ createSupabaseAnonClient: () => anon }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => fakeSupabase({ claims: claimsFor("owner") }),
}));
vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const pageRoute = await import("@/app/api/public/reservations/[slug]/page/route");
const slotsRoute = await import("@/app/api/public/reservations/[slug]/slots/route");
const requestsRoute = await import("@/app/api/public/reservations/[slug]/requests/route");
const cancelRoute = await import("@/app/api/public/reservations/[slug]/cancel/route");

const ORIGIN = "http://localhost:3000";
const BASE = `${ORIGIN}/api/public/reservations/${SLUG}`;
const NOW_S = Math.floor(NOW_MS / 1000);
const ID = "23000000-0000-4000-8000-000000000001";
const TOKEN = signCancelToken({ current: LINK_KEY }, ID, NOW_S + 3600);
const ctx = () => routeContext({ slug: SLUG });
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message, details: null },
});
const headersOf = {
  "content-type": "application/json",
  origin: ORIGIN,
  "x-forwarded-for": "203.0.113.7",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  vi.stubEnv("RESERVATION_GATE_KEY", GATE_KEY);
  vi.stubEnv("RESERVATION_LINK_KEY", LINK_KEY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** The whole answer as one string: status line, every header, the body. */
async function everything(response: Response): Promise<string> {
  const head = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  return `${response.status}\n${head}\n${await response.text()}`;
}

const GATE_VALUES = GATE_FUNCTIONS.map((fn) => gateMac(GATE_KEY, fn, SLUG, NOW_S));

function expectNoGate(text: string) {
  expect(text).not.toContain("p_gate");
  expect(text).not.toContain("gateMac");
  expect(text).not.toContain("gateTs");
  for (const value of GATE_VALUES) expect(text).not.toContain(value);
  expect(text).not.toContain(GATE_KEY);
}

describe("no answer of the public routes carries the gate", () => {
  it("is searching for real values (the MACs are 64 lower-case hex and differ per function)", () => {
    for (const value of GATE_VALUES) expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(GATE_VALUES).size).toBe(GATE_FUNCTIONS.length);
  });

  it("holds for the page, the slots, the request and the cancel view and cancel, on success and on error", async () => {
    const answers: Response[] = [];
    const runs: [string, () => Promise<Response>][] = [
      ["page ok", () => pageRoute.GET(new Request(`${BASE}/page`), ctx())],
      [
        "slots ok",
        () => slotsRoute.GET(new Request(`${BASE}/slots?date=2026-11-27&party=4`), ctx()),
      ],
      [
        "request ok",
        () =>
          requestsRoute.POST(
            jsonRequest(`${BASE}/requests`, requestBody(), { headers: headersOf }),
            ctx(),
          ),
      ],
      [
        "request refused",
        () =>
          requestsRoute.POST(
            jsonRequest(`${BASE}/requests`, requestBody(), {
              headers: { ...headersOf, "x-forwarded-for": "" },
            }),
            ctx(),
          ),
      ],
      [
        "request database error",
        () =>
          requestsRoute.POST(
            jsonRequest(`${BASE}/requests`, requestBody(), { headers: headersOf }),
            ctx(),
          ),
      ],
      [
        "cancel view",
        () => cancelRoute.GET(new Request(`${BASE}/cancel?t=${encodeURIComponent(TOKEN)}`), ctx()),
      ],
      [
        "cancel",
        () =>
          cancelRoute.POST(
            jsonRequest(`${BASE}/cancel`, { token: TOKEN }, { headers: headersOf }),
            ctx(),
          ),
      ],
      [
        "cancel bad link",
        () =>
          cancelRoute.POST(
            jsonRequest(`${BASE}/cancel`, { token: "garbage" }, { headers: headersOf }),
            ctx(),
          ),
      ],
    ];
    const rpcFor: Record<string, FakeResult[]> = {
      reservation_page: [ok(PAGE_REPLY)],
      reservation_slots: [ok(SLOTS_REPLY)],
      request_reservation: [ok({ status: "received" }), failure("P0001", "gate_refused")],
      reservation_cancel_view: [
        ok({
          date: "2026-11-27",
          time: "20:00",
          party: 4,
          serviceName: "Cena",
          status: "accepted",
          canCancel: true,
        }),
      ],
      cancel_reservation: [ok({ status: "cancelled", already: false })],
    };
    anon = fakeSupabase({ rpc: rpcFor });
    for (const [, run] of runs) answers.push(await run());
    expect(answers.map((a) => a.status)).toContain(200);
    expect(answers.map((a) => a.status)).toContain(202);
    for (const answer of answers) expectNoGate(await everything(answer));
    // The scan itself works: it does fail on a text that has the value.
    expect(() => expectNoGate(`x ${GATE_VALUES[0]}`)).toThrow();
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the public pages and routes never reach for the gate", () => {
  const files = [
    ...sources(join("src", "app", "(public)", "prenota")),
    ...sources(join("src", "app", "api", "public", "reservations")),
  ];

  it("finds the files it is meant to scan", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files)("%s does not name the gate MAC builder, its arguments or the key", (path) => {
    const text = readFileSync(path, "utf8");
    expect(text).not.toMatch(
      /gateMac|gateArgs|p_gate_mac|p_gate_ts|public\/gate["']|RESERVATION_GATE_KEY|gateKey/,
    );
  });
});
