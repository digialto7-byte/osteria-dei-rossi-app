import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  RESERVATION_SETTINGS,
  SET_RESERVATION_SETTINGS,
  SET_TABLE_BOOKING,
  TABLE_1,
  TABLE_BOOKING,
} from "../../helpers/reservations-data";
import { isMessageKey, messages } from "@/lib/i18n";
import { NOT_READY_REASONS, SETTINGS_INVALID_REASONS } from "@/server/reservations/constants";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const settingsRoute = await import("@/app/api/settings/reservations/route");
const tablesRoute = await import("@/app/api/settings/reservations/tables/route");
const SETTINGS_URL = "http://localhost:3000/api/settings/reservations";
const TABLES_URL = "http://localhost:3000/api/settings/reservations/tables";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details: details ?? null },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: {
      reservation_settings: [ok(RESERVATION_SETTINGS)],
      set_reservation_settings: [ok(SET_RESERVATION_SETTINGS)],
      table_booking: [ok(TABLE_BOOKING)],
      set_table_booking: [ok(SET_TABLE_BOOKING)],
      ...rpc,
    },
  });
}
const getSettings = (query = "") => settingsRoute.GET(new Request(`${SETTINGS_URL}${query}`));
const patchSettings = (body: unknown, init: RequestInit = {}) =>
  settingsRoute.PATCH(jsonRequest(SETTINGS_URL, body, { method: "PATCH", ...init }));
const getTables = () => tablesRoute.GET(new Request(TABLES_URL));
const putTables = (body: unknown, init: RequestInit = {}) =>
  tablesRoute.PUT(jsonRequest(TABLES_URL, body, { method: "PUT", ...init }));
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string; details?: unknown } })
    .error;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/settings/reservations", () => {
  it.each(["owner", "admin"])("%s gets the settings in one RPC", async (role) => {
    as(role);
    const response = await getSettings();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESERVATION_SETTINGS);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("reservation_settings");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await getSettings()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await getSettings()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("any query is 400 without an RPC", async () => {
    expect((await getSettings("?x=1")).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a reply with an extra key is a 500 that leaks nothing", async () => {
    as("owner", {
      reservation_settings: [ok({ ...RESERVATION_SETTINGS, createdBy: "Titolare Demo" })],
    });
    const response = await getSettings();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Titolare");
  });

  it("a reply with a money key never reaches the screen", async () => {
    as("owner", { reservation_settings: [ok({ ...RESERVATION_SETTINGS, depositEur: 5 })] });
    expect((await getSettings()).status).toBe(500);
  });

  it("matches the snapshot of the reply shape", async () => {
    expect(await (await getSettings()).json()).toMatchSnapshot();
  });
});

describe("PATCH /api/settings/reservations", () => {
  const BODY = { slotMinutes: 30, closedWeekdays: [1], publicSlug: "osteria-demo-a" };

  it.each(["owner", "admin"])("%s: one RPC with exactly { p_body }", async (role) => {
    as(role);
    const response = await patchSettings(BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SET_RESERVATION_SETTINGS);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("set_reservation_settings", { p_body: BODY });
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patchSettings(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await patchSettings(BODY)).status).toBe(401);
  });

  it("text/plain is 415 and a 5 KB body is 413, both without an RPC", async () => {
    expect((await patchSettings("x", { headers: { "content-type": "text/plain" } })).status).toBe(
      415,
    );
    const big = await patchSettings(BODY, {
      headers: { "content-type": "application/json", "content-length": "5120" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a full service row is sent as given", async () => {
    const services = [
      {
        key: "cena",
        online: true,
        firstSeating: "19:30",
        lastSeating: "22:00",
        coversPerSlot: 12,
        reservationsPerSlot: null,
        coversPerService: null,
      },
    ];
    expect((await patchSettings({ services })).status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("set_reservation_settings", { p_body: { services } });
  });

  it.each([
    ["an unknown key", { slotMinutes: 15, x: 1 }],
    ["an empty body", {}],
    ["slot 20", { slotMinutes: 20 }],
    ["slot 15 as text", { slotMinutes: "15" }],
    ["stay 29", { stayMinutes: 29 }],
    ["stay 361", { stayMinutes: 361 }],
    ["lead -1", { leadMinutes: -1 }],
    ["lead 2881", { leadMinutes: 2881 }],
    ["horizon 0", { horizonDays: 0 }],
    ["horizon 366", { horizonDays: 366 }],
    ["max party 0", { maxPartyOnline: 0 }],
    ["max party 41", { maxPartyOnline: 41 }],
    ["retention 0", { retentionDays: 0 }],
    ["a 1.5 horizon", { horizonDays: 1.5 }],
    ["a slug in capitals", { publicSlug: "Osteria" }],
    ["a one-letter slug", { publicSlug: "a" }],
    ["a slug ending with a dash", { publicSlug: "osteria-" }],
    ["a phone with letters", { venuePhone: "abc" }],
    ["weekday 8", { closedWeekdays: [8] }],
    ["a closed date that is not a date", { closedDates: ["2026-13-01"] }],
    ["a one-character privacy name", { privacyControllerName: "A" }],
    ["a privacy e-mail without @", { privacyContactEmail: "privacy" }],
    ["enabled as text", { enabled: "true" }],
    [
      "a service with a missing key",
      { services: [{ key: "cena", online: true, firstSeating: null, lastSeating: null }] },
    ],
    [
      "a service with a cost key",
      {
        services: [
          {
            key: "cena",
            online: true,
            firstSeating: null,
            lastSeating: null,
            coversPerSlot: null,
            reservationsPerSlot: null,
            coversPerService: null,
            costEur: 1,
          },
        ],
      },
    ],
    [
      "a limit of 1000",
      {
        services: [
          {
            key: "cena",
            online: true,
            firstSeating: null,
            lastSeating: null,
            coversPerSlot: 1000,
            reservationsPerSlot: null,
            coversPerService: null,
          },
        ],
      },
    ],
    [
      "a seating of 9:00",
      {
        services: [
          {
            key: "cena",
            online: true,
            firstSeating: "9:00",
            lastSeating: "10:00",
            coversPerSlot: null,
            reservationsPerSlot: null,
            coversPerService: null,
          },
        ],
      },
    ],
  ])("%s is 400 without an RPC", async (_label, body) => {
    expect((await patchSettings(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the lower bound",
      { stayMinutes: 30, leadMinutes: 0, horizonDays: 1, maxPartyOnline: 1, retentionDays: 1 },
    ],
    [
      "the upper bound",
      {
        stayMinutes: 360,
        leadMinutes: 2880,
        horizonDays: 365,
        maxPartyOnline: 40,
        retentionDays: 365,
      },
    ],
    [
      "nulls that clear",
      {
        publicSlug: null,
        venuePhone: null,
        privacyControllerName: null,
        privacyContactEmail: null,
      },
    ],
  ])("%s passes", async (_label, body) => {
    expect((await patchSettings(body)).status).toBe(200);
  });

  it("P0001 reservations_not_ready is 422 with the reasons and a sentence per reason", async () => {
    as("owner", {
      set_reservation_settings: [
        failure("P0001", "reservations_not_ready", '{"reasons": ["slug", "privacy_name"]}'),
      ],
    });
    const response = await patchSettings({ enabled: true });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe("reservations_not_ready");
    expect(error.details).toEqual({ reasons: ["slug", "privacy_name"] });
    expect(error.message).toBe(
      "Mancano ancora: indirizzo della pagina, nome del titolare del trattamento.",
    );
  });

  it("an unknown reason in the DETAIL is dropped, not echoed", async () => {
    as("owner", {
      set_reservation_settings: [
        failure("P0001", "reservations_not_ready", '{"reasons": ["slug", "Cliente Demo"]}'),
      ],
    });
    const response = await patchSettings({ enabled: true });
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).not.toContain("Cliente");
  });

  it("P0001 reservation_settings_invalid is 422 with the field as the reason", async () => {
    as("owner", {
      set_reservation_settings: [
        failure("P0001", "reservation_settings_invalid", '{"reason": "services"}'),
      ],
    });
    const response = await patchSettings({ slotMinutes: 15 });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe("reservation_settings_invalid");
    expect(error.details).toEqual({ reason: "services" });
    expect(error.message).toBe("Gli orari di prenotazione dei servizi non sono validi.");
  });

  it("P0001 slug_taken is 409", async () => {
    as("owner", { set_reservation_settings: [failure("P0001", "slug_taken")] });
    const response = await patchSettings({ publicSlug: "osteria-demo-b" });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("slug_taken");
  });

  it("22023 is 400 and 42501 is 403 (the function's own role check)", async () => {
    as("owner", { set_reservation_settings: [failure("22023", "invalid_request")] });
    expect((await patchSettings({ slotMinutes: 15 })).status).toBe(400);
    as("owner", { set_reservation_settings: [failure("42501", "x")] });
    expect((await patchSettings({ slotMinutes: 15 })).status).toBe(403);
  });

  it("an unexpected database error is a 500 that names no message", async () => {
    as("owner", { set_reservation_settings: [failure("XX000", "secret internals")] });
    const response = await patchSettings({ slotMinutes: 15 });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("a reply with an extra key is a 500", async () => {
    as("owner", { set_reservation_settings: [ok({ ...SET_RESERVATION_SETTINGS, x: 1 })] });
    expect((await patchSettings({ slotMinutes: 15 })).status).toBe(500);
  });
});

describe("GET and PUT /api/settings/reservations/tables", () => {
  const BODY = { tables: [{ tableId: TABLE_1, bookable: true, seats: 4 }] };

  it.each(["owner", "admin"])("%s reads the tables and groups in one RPC", async (role) => {
    as(role);
    const response = await getTables();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TABLE_BOOKING);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("table_booking");
  });

  it.each(["owner", "admin"])("%s: PUT is one RPC with exactly { p_body }", async (role) => {
    as(role);
    const response = await putTables(BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SET_TABLE_BOOKING);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("set_table_booking", { p_body: BODY });
  });

  it.each(["waiter", "chef"])("%s gets 403 on GET and PUT before any RPC", async (role) => {
    as(role);
    expect((await getTables()).status).toBe(403);
    expect((await putTables(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await getTables()).status).toBe(401);
    expect((await putTables(BODY)).status).toBe(401);
  });

  it("text/plain is 415 and 5 KB is 413", async () => {
    expect((await putTables("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await putTables(BODY, {
          headers: { "content-type": "application/json", "content-length": "5120" },
        })
      ).status,
    ).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a null seats is allowed (the table is listed without seats)", async () => {
    expect(
      (await putTables({ tables: [{ tableId: TABLE_1, bookable: false, seats: null }] })).status,
    ).toBe(200);
  });

  it.each([
    ["no tables", { tables: [] }],
    ["seats 0", { tables: [{ tableId: TABLE_1, bookable: true, seats: 0 }] }],
    ["seats 41", { tables: [{ tableId: TABLE_1, bookable: true, seats: 41 }] }],
    ["seats 2.5", { tables: [{ tableId: TABLE_1, bookable: true, seats: 2.5 }] }],
    ["a table id that is not a uuid", { tables: [{ tableId: "1", bookable: true, seats: 2 }] }],
    ["a missing seats", { tables: [{ tableId: TABLE_1, bookable: true }] }],
    [
      "an extra key in a table",
      { tables: [{ tableId: TABLE_1, bookable: true, seats: 2, name: "x" }] },
    ],
    ["an extra top-level key", { ...BODY, x: 1 }],
    [
      "201 tables",
      {
        tables: Array.from({ length: 201 }, () => ({ tableId: TABLE_1, bookable: true, seats: 2 })),
      },
    ],
  ])("%s is 400 without an RPC", async (_label, body) => {
    expect((await putTables(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0002 table_not_found is 404", async () => {
    as("owner", { set_table_booking: [failure("P0002", "table_not_found")] });
    const response = await putTables(BODY);
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
  });

  it("P0001 table_booking_invalid is 422 with the reason", async () => {
    as("owner", {
      set_table_booking: [failure("P0001", "table_booking_invalid", '{"reason": "duplicate"}')],
    });
    const response = await putTables(BODY);
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe("table_booking_invalid");
    expect(error.details).toEqual({ reason: "duplicate" });
  });

  it("a reply with an extra key is a 500", async () => {
    as("owner", { table_booking: [ok({ ...TABLE_BOOKING, x: 1 })] });
    expect((await getTables()).status).toBe(500);
  });

  it("matches the snapshot of the reply shape", async () => {
    expect(await (await getTables()).json()).toMatchSnapshot();
  });
});

describe("the it and en texts of the settings errors", () => {
  const keys = (prefix: string, reasons: readonly string[]) => reasons.map((r) => `${prefix}.${r}`);
  it.each([
    ...keys("reservationError.settings", SETTINGS_INVALID_REASONS),
    ...keys("reservationError.notReady", NOT_READY_REASONS),
    "reservationError.slug_taken",
  ])("%s has an Italian and an English text", (key) => {
    expect(isMessageKey(key), key).toBe(true);
    if (!isMessageKey(key)) return;
    expect(messages.it[key].trim()).not.toBe("");
    expect(messages.en[key].trim()).not.toBe("");
  });
});
