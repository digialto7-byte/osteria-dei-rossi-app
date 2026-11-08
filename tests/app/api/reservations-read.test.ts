import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  PENDING_COUNT,
  RESERVATION_1,
  RESERVATION_DETAIL,
  RESERVATIONS_DAY,
  WAITER_RESERVATION_DETAIL,
  WAITER_RESERVATIONS_DAY,
} from "../../helpers/reservations-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const listRoute = await import("@/app/api/reservations/route");
const detailRoute = await import("@/app/api/reservations/[id]/route");
const pendingRoute = await import("@/app/api/reservations/pending-count/route");
const BASE = "http://localhost:3000/api/reservations";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details: details ?? null },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  const waiter = role === "waiter";
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: {
      reservations_day: [ok(waiter ? WAITER_RESERVATIONS_DAY : RESERVATIONS_DAY)],
      reservation_detail: [ok(waiter ? WAITER_RESERVATION_DETAIL : RESERVATION_DETAIL)],
      reservations_pending_count: [ok(PENDING_COUNT)],
      ...rpc,
    },
  });
}
const list = (query = "") => listRoute.GET(new Request(`${BASE}${query}`));
const detail = (id: string) => detailRoute.GET(new Request(`${BASE}/${id}`), routeContext({ id }));
const pending = () => pendingRoute.GET(new Request(`${BASE}/pending-count`));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/reservations?date=", () => {
  it.each(["owner", "admin"])("%s reads the day in one RPC, with emailStatus", async (role) => {
    as(role);
    const response = await list("?date=2026-11-20");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESERVATIONS_DAY);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("reservations_day", { p_date: "2026-11-20" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("no date asks for today's business day (p_date null)", async () => {
    expect((await list()).status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("reservations_day", { p_date: null });
  });

  it("a waiter gets 200 with the customer data and no emailStatus key", async () => {
    as("waiter");
    const response = await list("?date=2026-11-20");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(WAITER_RESERVATIONS_DAY);
    expect(JSON.stringify(body)).not.toContain("emailStatus");
    expect(body.services[1].reservations[0].name).toBe("Cliente Demo");
  });

  it("a waiter reply that carries emailStatus is a 500 (the strict waiter schema)", async () => {
    as("waiter", { reservations_day: [ok(RESERVATIONS_DAY)] });
    const response = await list("?date=2026-11-20");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Cliente");
  });

  it("an owner reply without emailStatus is a 500 too", async () => {
    as("owner", { reservations_day: [ok(WAITER_RESERVATIONS_DAY)] });
    expect((await list("?date=2026-11-20")).status).toBe(500);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await list("?date=2026-11-20")).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await list()).status).toBe(401);
  });

  it.each([
    "?date=2026-13-01",
    "?date=2026-02-30",
    "?date=20-11-2026",
    "?date=",
    "?x=1",
    "?date=2026-11-20&date=2026-11-21",
  ])("%s is 400 without an RPC", async (query) => {
    expect((await list(query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a date outside the window (the database's P0001 date_invalid) is 422 date_invalid with an Italian message and no RPC detail", async () => {
    as("owner", { reservations_day: [failure("P0001", "date_invalid")] });
    const response = await list("?date=2020-01-01");
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("date_invalid");
    expect(error.message).toBe(
      "La data non è valida: puoi vedere da 62 giorni fa fino al limite delle prenotazioni.",
    );
    expect(reportError).not.toHaveBeenCalled();
  });

  it("date_invalid has an English message too, and the waiter gets the same 422", async () => {
    expect(t("reservationError.date_invalid", {}, "en")).toBe(
      "The date is not valid: you can look from 62 days back up to the booking horizon.",
    );
    as("waiter", { reservations_day: [failure("P0001", "date_invalid")] });
    const response = await list("?date=2030-01-01");
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("date_invalid");
  });

  it("a reply with an extra key in a row is a 500", async () => {
    const bad = structuredClone(RESERVATIONS_DAY) as unknown as {
      services: { reservations: Record<string, unknown>[] }[];
    };
    bad.services[1]!.reservations[0]!.priceEur = 12;
    as("owner", { reservations_day: [ok(bad)] });
    expect((await list("?date=2026-11-20")).status).toBe(500);
  });

  it("a failed read reports codes only: no name, phone or e-mail reaches reportError", async () => {
    const bad = structuredClone(RESERVATIONS_DAY) as unknown as {
      services: { reservations: Record<string, unknown>[] }[];
    };
    bad.services[1]!.reservations[0]!.party = "Cliente Demo";
    bad.services[1]!.reservations[0]!.status = "cliente.demo@example.com";
    as("owner", { reservations_day: [ok(bad)] });
    expect((await list("?date=2026-11-20")).status).toBe(500);
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = String((reportError.mock.calls[0]![0] as Error).message);
    for (const secret of ["Cliente", "cliente.demo", "390000000001", "example.com"]) {
      expect(reported).not.toContain(secret);
    }
  });

  it("an unexpected database error is a 500 that names no message", async () => {
    as("owner", { reservations_day: [failure("XX000", "secret internals")] });
    const response = await list("?date=2026-11-20");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("a 42501 from the function is 403", async () => {
    as("owner", { reservations_day: [failure("42501", "x")] });
    expect((await list("?date=2026-11-20")).status).toBe(403);
  });

  it("matches the snapshot of the owner's and the waiter's reply shape", async () => {
    expect(await (await list("?date=2026-11-20")).json()).toMatchSnapshot("owner");
    as("waiter");
    expect(await (await list("?date=2026-11-20")).json()).toMatchSnapshot("waiter");
  });
});

describe("GET /api/reservations/:id", () => {
  it("owner and admin get the detail with the suggestion", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      const response = await detail(RESERVATION_1);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(RESERVATION_DETAIL);
      expect(client.rpc).toHaveBeenCalledWith("reservation_detail", { p_id: RESERVATION_1 });
      expect(client.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("a waiter gets the detail with the events and no suggestion and no emailStatus", async () => {
    as("waiter");
    const response = await detail(RESERVATION_1);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(WAITER_RESERVATION_DETAIL);
    expect(body).not.toHaveProperty("suggestion");
    expect(body).not.toHaveProperty("emailStatus");
  });

  it("a waiter reply that carries a suggestion is a 500", async () => {
    as("waiter", {
      reservation_detail: [
        ok({ ...WAITER_RESERVATION_DETAIL, suggestion: RESERVATION_DETAIL.suggestion }),
      ],
    });
    expect((await detail(RESERVATION_1)).status).toBe(500);
  });

  it("the events carry kind and time only (a staff name is a 500)", async () => {
    as("owner", {
      reservation_detail: [
        ok({
          ...RESERVATION_DETAIL,
          events: [{ kind: "accepted", at: "2026-11-08T10:00:00Z", by: "Titolare Demo" }],
        }),
      ],
    });
    const response = await detail(RESERVATION_1);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Titolare");
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await detail(RESERVATION_1)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["not-a-uuid", "123", "pending-count-x"])(
    "the id %s is 404 without an RPC",
    async (id) => {
      expect((await detail(id)).status).toBe(404);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("P0002 reservation_not_found is 404", async () => {
    as("owner", { reservation_detail: [failure("P0002", "reservation_not_found")] });
    const response = await detail(RESERVATION_1);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("matches the snapshot", async () => {
    expect(await (await detail(RESERVATION_1)).json()).toMatchSnapshot();
  });
});

describe("GET /api/reservations/pending-count", () => {
  it.each(["owner", "admin"])("%s reads the badge number in one RPC", async (role) => {
    as(role);
    const response = await pending();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PENDING_COUNT);
    expect(client.rpc).toHaveBeenCalledWith("reservations_pending_count");
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await pending()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a reply with an extra key is a 500", async () => {
    as("owner", { reservations_pending_count: [ok({ pending: 1, names: [] })] });
    expect((await pending()).status).toBe(500);
  });
});
