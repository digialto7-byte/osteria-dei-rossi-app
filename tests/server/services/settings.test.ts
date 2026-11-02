import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { fakeSupabase } from "../../helpers/fake-supabase";
import { SERVICE_PERIOD_REASONS } from "@/server/services/constants";
import { mapServicesDbError } from "@/server/services/errors";
import { servicePeriodsOutput, setServicePeriodsOutput } from "@/server/services/output";
import { servicesBody } from "@/server/services/schemas";
import { readServices, saveServices } from "@/server/services/settings";
import { it as italian } from "@/lib/i18n/messages/it";
import { en } from "@/lib/i18n/messages/en";
import { claimsFor } from "../../helpers/fake-supabase";
import { SERVICE_PERIODS, SET_SERVICE_PERIODS } from "../../helpers/services-data";

const ok = (data: unknown) => ({ data, error: null });

describe("servicesBody", () => {
  const period = { key: "pranzo", name: "Pranzo", startsAt: "11:00" };
  it("accepts 1 to 6 periods, a null key for a new one", () => {
    expect(servicesBody.safeParse({ periods: [period] }).success).toBe(true);
    expect(servicesBody.safeParse({ periods: [{ ...period, key: null }] }).success).toBe(true);
    expect(servicesBody.safeParse({ periods: Array(6).fill(period) }).success).toBe(true);
  });
  it.each([
    ["no periods", { periods: [] }],
    ["seven periods", { periods: Array(7).fill(period) }],
    ["a start of 9:00", { periods: [{ ...period, startsAt: "9:00" }] }],
    ["a start of 24:00", { periods: [{ ...period, startsAt: "24:00" }] }],
    ["a start with seconds", { periods: [{ ...period, startsAt: "11:00:00" }] }],
    ["an upper-case key", { periods: [{ ...period, key: "Pranzo" }] }],
    ["a blank name", { periods: [{ ...period, name: "   " }] }],
    ["a 31-character name", { periods: [{ ...period, name: "x".repeat(31) }] }],
    ["an extra key in a period", { periods: [{ ...period, endsAt: "15:00" }] }],
    ["an extra top-level key", { periods: [period], x: 1 }],
    ["a missing key", { periods: [{ name: "Pranzo", startsAt: "11:00" }] }],
  ])("refuses %s", (_label, body) => {
    expect(servicesBody.safeParse(body).success).toBe(false);
  });
  it("trims the name", () => {
    const parsed = servicesBody.parse({ periods: [{ ...period, name: "  Pranzo " }] });
    expect(parsed.periods[0]!.name).toBe("Pranzo");
  });
});

describe("outputs", () => {
  it("parse the documented replies and snapshot their keys", () => {
    expect(servicePeriodsOutput.parse(SERVICE_PERIODS)).toEqual(SERVICE_PERIODS);
    expect(setServicePeriodsOutput.parse(SET_SERVICE_PERIODS)).toEqual(SET_SERVICE_PERIODS);
    expect(Object.keys(SERVICE_PERIODS).sort()).toMatchSnapshot("servicePeriodsOutput keys");
    expect(Object.keys(SET_SERVICE_PERIODS).sort()).toMatchSnapshot("setServicePeriodsOutput keys");
  });
  it("refuse an extra key (a staff name must not pass)", () => {
    expect(servicePeriodsOutput.safeParse({ ...SERVICE_PERIODS, createdBy: "x" }).success).toBe(
      false,
    );
    expect(
      servicePeriodsOutput.safeParse({
        ...SERVICE_PERIODS,
        periods: [{ ...SERVICE_PERIODS.periods[0], position: 1 }],
      }).success,
    ).toBe(false);
  });
  it("accept a null since (the default)", () => {
    expect(
      servicePeriodsOutput.safeParse({ ...SERVICE_PERIODS, since: null, isDefault: true }).success,
    ).toBe(true);
  });
});

describe("mapServicesDbError", () => {
  it("42501 is 403 forbidden", () => {
    const e = mapServicesDbError({ code: "42501", message: "x" });
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(403);
  });
  it("22023 is 400 invalid_request", () => {
    expect(
      (mapServicesDbError({ code: "22023", message: "invalid_request" }) as ApiError).status,
    ).toBe(400);
  });
  it.each([...SERVICE_PERIOD_REASONS])(
    "service_periods_invalid with reason %s is 422 with details",
    (reason) => {
      const e = mapServicesDbError({
        code: "P0001",
        message: "service_periods_invalid",
        details: JSON.stringify({ reason }),
      }) as ApiError;
      expect(e.status).toBe(422);
      expect(e.code).toBe("service_periods_invalid");
      expect(e.details).toEqual({ reason });
      expect(e.message.length).toBeGreaterThan(5);
      expect(italian[`serviceError.reason.${reason}`]).toBe(e.message);
      expect(en[`serviceError.reason.${reason}`]).toBeTruthy();
    },
  );
  it("start_twice says the sentence of the plan", () => {
    const e = mapServicesDbError({
      code: "P0001",
      message: "service_periods_invalid",
      details: '{"reason": "start_twice"}',
    }) as ApiError;
    expect(e.message).toBe("Due servizi non possono iniziare alla stessa ora.");
  });
  it("an unknown reason or a broken detail is not echoed: a plain Error", () => {
    for (const details of ['{"reason": "secret thing"}', "not json", null, '{"reason": 5}']) {
      const e = mapServicesDbError({ code: "P0001", message: "service_periods_invalid", details });
      expect(e).not.toBeInstanceOf(ApiError);
    }
  });
  it("anything else names only the SQLSTATE", () => {
    const e = mapServicesDbError({ code: "XX000", message: "secret" });
    expect(e).not.toBeInstanceOf(ApiError);
    expect(e.message).toBe("Unexpected database error XX000");
    expect(e.message).not.toContain("secret");
  });
});

describe("readServices and saveServices", () => {
  it("readServices calls service_periods with no argument and parses the reply", async () => {
    const client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { service_periods: [ok(SERVICE_PERIODS)] },
    });
    expect(await readServices(client as unknown as SupabaseClient)).toEqual(SERVICE_PERIODS);
    expect(client.rpc).toHaveBeenCalledWith("service_periods");
  });
  it("saveServices sends exactly { p_body } and parses the reply", async () => {
    const client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { set_service_periods: [ok(SET_SERVICE_PERIODS)] },
    });
    const body = { periods: [{ key: null, name: "Aperitivo", startsAt: "18:00" }] };
    expect(await saveServices(client as unknown as SupabaseClient, body)).toEqual(
      SET_SERVICE_PERIODS,
    );
    expect(client.rpc).toHaveBeenCalledWith("set_service_periods", { p_body: body });
  });
  it("a reply with an extra key throws (the route answers 500)", async () => {
    const client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { service_periods: [ok({ ...SERVICE_PERIODS, createdBy: "x" })] },
    });
    await expect(readServices(client as unknown as SupabaseClient)).rejects.toThrow();
  });
  it("a database error is mapped", async () => {
    const client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: {
        set_service_periods: [
          {
            data: null,
            error: {
              code: "P0001",
              message: "service_periods_invalid",
              details: '{"reason": "count"}',
            },
          },
        ],
      },
    });
    await expect(
      saveServices(client as unknown as SupabaseClient, { periods: [] as never }),
    ).rejects.toMatchObject({
      status: 422,
      code: "service_periods_invalid",
    });
  });
});
