import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { ConfigError } from "@/lib/env";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";

const SECRET = "test-cron-secret-0123456789abcdef0123456789";
const reportError = vi.fn();
const createAdmin = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => createAdmin() }));

const { withCron } = await import("@/server/cron/with-cron");

const URL_ = "http://localhost:3000/api/cron/extract";
const post = (authorization?: string) =>
  new Request(URL_, {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
    body: JSON.stringify({ secret_payload: "do-not-report-me" }),
  });
const valid = () => post(`Bearer ${SECRET}`);

type Result = { claimed: string | null };
const countItems = (result: Result) => (result.claimed === null ? 0 : 1);
const OK: FakeResult = { data: null, error: null };
const START_ID: FakeResult = { data: 42, error: null };

/** A fake admin client whose job_run RPCs answer as given; calls are read back from `rpc`. */
function admin(rpc: Record<string, FakeResult[]> = {}) {
  const fake = fakeSupabase({
    rpc: { job_run_start: [START_ID], job_run_finish: [OK], ...rpc },
  });
  createAdmin.mockReturnValue(fake);
  return fake;
}
const calls = (fake: ReturnType<typeof admin>) =>
  fake.rpc.mock.calls.map(([fn, args]) => [fn, args] as const);

beforeEach(() => {
  reportError.mockReset();
  createAdmin.mockReset();
  vi.stubEnv("CRON_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("withCron records an authorised run", () => {
  it("starts the run, runs the handler, then finishes it with the item count", async () => {
    const fake = admin();
    const order: string[] = [];
    fake.rpc.mockImplementation((fn: string) => {
      order.push(fn);
      return Promise.resolve(fn === "job_run_start" ? START_ID : OK);
    });
    const handler = vi.fn(async () => {
      order.push("handler");
      return { claimed: "inv-1" };
    });

    const response = await withCron({ job: "extract", countItems }, handler)(valid());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: "inv-1" });
    expect(order).toEqual(["job_run_start", "handler", "job_run_finish"]);
    expect(calls(fake)).toEqual([
      ["job_run_start", { p_job: "extract" }],
      ["job_run_finish", { p_id: 42, p_ok: true, p_error_code: null, p_items: 1 }],
    ]);
  });

  it("hands the handler the request and the one admin client it created", async () => {
    const fake = admin();
    const handler = vi.fn(async () => ({ claimed: null }));
    await withCron({ job: "extract", countItems }, handler)(valid());
    expect(createAdmin).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.any(Request), fake);
  });

  it("counts zero items when the handler found nothing to do", async () => {
    const fake = admin();
    await withCron({ job: "extract", countItems }, async () => ({ claimed: null }))(valid());
    expect(calls(fake)[1]).toEqual([
      "job_run_finish",
      { p_id: 42, p_ok: true, p_error_code: null, p_items: 0 },
    ]);
  });

  it("a ConfigError in the handler ends the run as config_missing and answers 500", async () => {
    const fake = admin();
    const error = new ConfigError(["EXTRACTION_MODEL_ID"]);
    const response = await withCron({ job: "extract", countItems }, async () => {
      throw error;
    })(valid());
    expect(response.status).toBe(500);
    expect(calls(fake)[1]).toEqual([
      "job_run_finish",
      { p_id: 42, p_ok: false, p_error_code: "config_missing", p_items: 0 },
    ]);
    expect(reportError).toHaveBeenCalledWith(error);
  });

  it("any other error ends the run as internal, answers 500 and reports without the request", async () => {
    const fake = admin();
    const error = new Error("db down");
    const response = await withCron({ job: "extract", countItems }, async () => {
      throw error;
    })(valid());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal", message: "Errore interno." },
    });
    expect(calls(fake)[1]).toEqual([
      "job_run_finish",
      { p_id: 42, p_ok: false, p_error_code: "internal", p_items: 0 },
    ]);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error);
    expect(JSON.stringify(reportError.mock.calls)).not.toContain("do-not-report-me");
  });

  it("an ApiError from the handler ends the run as api_error and answers with its status, unreported", async () => {
    const fake = admin();
    const response = await withCron({ job: "extract", countItems }, async () => {
      throw new ApiError(409, "conflict", "Già in corso.");
    })(valid());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "conflict", message: "Già in corso." },
    });
    expect(calls(fake)[1]).toEqual([
      "job_run_finish",
      { p_id: 42, p_ok: false, p_error_code: "api_error", p_items: 0 },
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("a run that cannot be started is reported and the handler still runs", async () => {
    const fake = admin({
      job_run_start: [{ data: null, error: { code: "42501", message: "secret detail" } }],
    });
    const handler = vi.fn(async () => ({ claimed: "inv-1" }));
    const response = await withCron({ job: "extract", countItems }, handler)(valid());
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls(fake).map(([fn]) => fn)).toEqual(["job_run_start"]); // nothing to finish
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0]?.[0])).toContain("42501");
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain("secret detail");
  });

  it("a start that throws is reported and the handler still runs", async () => {
    const fake = admin();
    fake.rpc.mockRejectedValueOnce(new Error("network"));
    const handler = vi.fn(async () => ({ claimed: null }));
    const response = await withCron({ job: "extract", countItems }, handler)(valid());
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("a finish that fails is reported and does not change the answer", async () => {
    admin({
      job_run_finish: [{ data: null, error: { code: "P0001", message: "job_run_finished" } }],
    });
    const response = await withCron({ job: "extract", countItems }, async () => ({
      claimed: "inv-1",
    }))(valid());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: "inv-1" });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0]?.[0])).toContain("P0001");
  });

  it("no admin client (missing secret key) is a 500 and nothing runs", async () => {
    createAdmin.mockImplementation(() => {
      throw new ConfigError(["SUPABASE_SECRET_KEY"]);
    });
    const handler = vi.fn();
    const response = await withCron({ job: "extract", countItems }, handler)(valid());
    expect(response.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("withCron records nothing for a refused call (AT5)", () => {
  it.each([
    ["no bearer", post(undefined), 401],
    ["a wrong bearer", post("Bearer wrong"), 401],
    ["a Basic scheme", post(`Basic ${SECRET}`), 401],
    ["GET", new Request(URL_, { method: "GET" }), 405],
  ])("%s -> %i, no admin client, no RPC, no handler", async (_name, request, status) => {
    const fake = admin();
    const handler = vi.fn();
    const response = await withCron({ job: "extract", countItems }, handler)(request);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (status === 405) expect(response.headers.get("allow")).toBe("POST");
    expect(createAdmin).not.toHaveBeenCalled();
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
