import { beforeEach, describe, expect, it, vi } from "vitest";
import { it as itMessages } from "@/lib/i18n/messages/it";
import { en as enMessages } from "@/lib/i18n/messages/en";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// SP1 step 13 (plan §3.3): PATCH /api/settings/venue, owner and admin only, one set_tenant_settings call per request.
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/settings/venue/route");
const URL_ = "http://localhost:3000/api/settings/venue";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const SETTINGS = {
  timeZone: "Europe/Rome",
  locale: "it",
  currency: "EUR",
  receiptTypes: ["scontrino", "fattura"],
  paymentTypes: ["cash", "card", "other"],
  saleVatRates: [10, 22],
};
const CHANGE = { changed: true, settings: SETTINGS };
const BODY = { saleVatRates: [10, 22] };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { set_tenant_settings: [ok(CHANGE)], ...rpc },
  });
}
const patch = (body: unknown, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("PATCH /api/settings/venue", () => {
  it("an owner's PATCH with saleVatRates [10, 22] calls set_tenant_settings once and answers 200 with changed true", async () => {
    const response = await patch(BODY);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.changed).toBe(true);
    expect(json.settings.saleVatRates).toEqual([10, 22]);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("set_tenant_settings", { p_patch: BODY });
  });

  it("an admin may write too, and the body goes to the RPC untouched", async () => {
    as("admin");
    const body = { locale: "en", receiptTypes: ["fattura"], paymentTypes: ["card", "cash"] };
    const response = await patch(body);
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("set_tenant_settings", { p_patch: body });
  });

  it("an unchanged patch answers changed false", async () => {
    as("owner", { set_tenant_settings: [ok({ changed: false, settings: SETTINGS })] });
    const json = await (await patch(BODY)).json();
    expect(json.changed).toBe(false);
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patch(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await patch(BODY)).status).toBe(401);
  });

  it("only PATCH is exported", () => {
    expect(Object.keys(route).sort()).toEqual(["PATCH"]);
  });

  it("text/plain is 415 and a body over 4 KiB is 413, with no RPC", async () => {
    expect((await patch("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await patch(BODY, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { extra: 1 }],
    ["an unknown key beside a valid one", { saleVatRates: [10], extra: 1 }],
    ["an empty body", {}],
    ["a locale that is not a string", { locale: 1 }],
    ["saleVatRates that is not an array", { saleVatRates: 10 }],
    ["a rate that is not a number", { saleVatRates: ["10"] }],
    ["a receipt code that is not a string", { receiptTypes: [1] }],
    ["more than 20 payment codes", { paymentTypes: Array.from({ length: 21 }, () => "cash") }],
    ["more than 20 rates", { saleVatRates: Array.from({ length: 21 }, () => 10) }],
    ["null for a list", { receiptTypes: null }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["locale_invalid"],
    ["vat_rate_invalid"],
    ["receipt_type_invalid"],
    ["payment_type_invalid"],
    ["settings_list_empty"],
  ])("P0001 %s is 422 with its Italian text", async (code) => {
    as("owner", { set_tenant_settings: [failure("P0001", code)] });
    const response = await patch(BODY);
    expect(response.status).toBe(422);
    const error = (await response.json()).error;
    expect(error.code).toBe(code);
    expect(error.message).toBe(itMessages[`venueSettingsError.${code}` as keyof typeof itMessages]);
    expect(error.message).not.toBe(code);
  });

  it("22023 from the database is 400 invalid_request", async () => {
    as("owner", { set_tenant_settings: [failure("22023", "invalid_request")] });
    const response = await patch(BODY);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("42501 from the database is 403 forbidden", async () => {
    as("owner", { set_tenant_settings: [failure("42501", "permission denied")] });
    const response = await patch(BODY);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
  });

  it("an unknown P0001 message is a 500 that does not repeat the database text", async () => {
    as("owner", { set_tenant_settings: [failure("P0001", "secret_internal_detail")] });
    const response = await patch(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret_internal_detail");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("a reply that breaks the output schema is a 500 (an injected cost key is refused)", async () => {
    as("owner", {
      set_tenant_settings: [ok({ changed: true, settings: { ...SETTINGS, unitCost: 3.2 } })],
    });
    const response = await patch(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("unitCost");
  });

  it("the answer is not offline-cacheable and nothing in it is cost-like besides saleVatRates", async () => {
    const response = await patch(BODY);
    expect(response.headers.has("x-offline-cache")).toBe(false);
    const keys = Object.keys((await response.json()).settings);
    expect(keys.filter((k) => /cost|margin|food|gp|vat|recipe|price/i.test(k))).toEqual([
      "saleVatRates",
    ]);
  });
});

describe("the venueSettingsError texts", () => {
  const CODES = [
    "locale_invalid",
    "vat_rate_invalid",
    "receipt_type_invalid",
    "payment_type_invalid",
    "settings_list_empty",
  ];
  it.each(CODES)("%s has an Italian and an English text", (code) => {
    const key = `venueSettingsError.${code}` as keyof typeof itMessages;
    expect(itMessages[key]).toBeTruthy();
    expect(enMessages[key as keyof typeof enMessages]).toBeTruthy();
  });
});
