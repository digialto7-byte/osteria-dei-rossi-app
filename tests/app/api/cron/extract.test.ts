import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "@/lib/env";
import {
  EXTRACT_MAX_DURATION_S,
  EXTRACTION_LEASE_SECONDS,
  EXTRACTION_TIMEOUT_MS,
} from "@/server/extraction/constants";
import { fakeSupabase } from "../../../helpers/fake-supabase";

const SECRET = "test-cron-secret-0123456789abcdef0123456789";
const reportError = vi.fn();
const admin = vi.fn();
const job = vi.hoisted(() => ({ impl: null as null | ((deps: unknown) => Promise<unknown>) }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => admin() }));
vi.mock("@/server/cron/extract-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cron/extract-job")>();
  return {
    runExtractionJob: (deps: Parameters<typeof actual.runExtractionJob>[0]) =>
      job.impl ? job.impl(deps) : actual.runExtractionJob(deps),
  };
});

const route = await import("@/app/api/cron/extract/route");
const { withCron } = await import("@/server/cron/with-cron");

const URL_ = "http://localhost:3000/api/cron/extract";
const post = (authorization?: string) =>
  new Request(URL_, {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
    body: "{}",
  });
type Body = { error: { code: string } };
const body = async (response: Response) => (await response.json()) as Body;

let jobSpy: ReturnType<typeof vi.fn<(deps: unknown) => Promise<unknown>>>;
beforeEach(() => {
  reportError.mockReset();
  // job_run_start answers with a run id, as the database does.
  admin
    .mockReset()
    .mockReturnValue(fakeSupabase({ rpc: { job_run_start: [{ data: 1, error: null }] } }));
  jobSpy = vi.fn<(deps: unknown) => Promise<unknown>>(async () => ({ claimed: null }));
  job.impl = jobSpy;
  vi.stubEnv("CRON_SECRET", SECRET);
});
afterEach(() => {
  job.impl = null;
  vi.unstubAllEnvs();
});

describe("POST /api/cron/extract authentication", () => {
  it.each([
    ["no header", undefined],
    ["Basic scheme", `Basic ${SECRET}`],
    ["wrong token", "Bearer wrong-token-0123456789abcdef0123456789"],
    ["shorter token", "Bearer short"],
    ["longer token", `Bearer ${SECRET}x`],
    ["empty token", "Bearer "],
    ["token without scheme", SECRET],
  ])("%s -> 401, no job and no admin client", async (_name, header) => {
    const response = await route.POST(post(header));
    expect(response.status).toBe(401);
    expect((await body(response)).error.code).toBe("unauthenticated");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(jobSpy).not.toHaveBeenCalled();
    expect(admin).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when CRON_SECRET is unset, naming it to Sentry only", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect((await body(response)).error.code).toBe("internal");
    expect(jobSpy).not.toHaveBeenCalled();
    expect(admin).not.toHaveBeenCalled();
    const reported = reportError.mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(ConfigError);
    expect((reported as ConfigError).variables).toEqual(["CRON_SECRET"]);
  });

  it("rejects a too-short CRON_SECRET the same way", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    const response = await route.POST(post("Bearer short"));
    expect(response.status).toBe(500);
    expect(jobSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/extract with the right bearer", () => {
  it("runs the job once and returns its result", async () => {
    jobSpy.mockResolvedValue({ claimed: "inv-1", status: "review" });
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: "inv-1", status: "review" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(jobSpy).toHaveBeenCalledTimes(1);
    expect(admin).toHaveBeenCalledTimes(1);
  });

  it("accepts the scheme case-insensitively", async () => {
    const response = await route.POST(post(`bearer ${SECRET}`));
    expect(response.status).toBe(200);
  });

  it("passes a working clock and a client factory to the job", async () => {
    await route.POST(post(`Bearer ${SECRET}`));
    const deps = jobSpy.mock.calls[0]?.[0] as {
      now: () => number;
      makeClient: (env: { anthropicApiKey: string; modelId: string }) => unknown;
    };
    expect(deps.now()).toBeGreaterThan(1_700_000_000_000);
    expect(deps.makeClient({ anthropicApiKey: "test-key", modelId: "m" })).toBeDefined();
  });

  it("a missing EXTRACTION_MODEL_ID is a 500 and nothing is claimed (AT5)", async () => {
    job.impl = null; // the real job
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("EXTRACTION_MODEL_ID", "");
    const fake = fakeSupabase({ rpc: { job_run_start: [{ data: 9, error: null }] } });
    admin.mockReturnValue(fake);
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect((await body(response)).error.code).toBe("internal");
    // Nothing is claimed; the only calls are the run record, which ends as config_missing.
    expect(fake.rpc.mock.calls.map(([fn]) => fn)).toEqual(["job_run_start", "job_run_finish"]);
    expect(fake.rpc).toHaveBeenLastCalledWith("job_run_finish", {
      p_id: 9,
      p_ok: false,
      p_error_code: "config_missing",
      p_items: 0,
    });
    const reported = reportError.mock.calls[0]?.[0] as ConfigError;
    expect(reported).toBeInstanceOf(ConfigError);
    expect(reported.variables).toEqual(["EXTRACTION_MODEL_ID"]);
  });

  it("records the run: items 1 when an invoice was claimed", async () => {
    const fake = fakeSupabase({ rpc: { job_run_start: [{ data: 7, error: null }] } });
    admin.mockReturnValue(fake);
    jobSpy.mockResolvedValue({ claimed: "inv-1", status: "review" });
    await route.POST(post(`Bearer ${SECRET}`));
    expect(fake.rpc).toHaveBeenCalledWith("job_run_start", { p_job: "extract" });
    expect(fake.rpc).toHaveBeenLastCalledWith("job_run_finish", {
      p_id: 7,
      p_ok: true,
      p_error_code: null,
      p_items: 1,
    });
  });

  it("records the run: items 0 when none was claimed", async () => {
    const fake = fakeSupabase({ rpc: { job_run_start: [{ data: 8, error: null }] } });
    admin.mockReturnValue(fake);
    await route.POST(post(`Bearer ${SECRET}`));
    expect(fake.rpc).toHaveBeenLastCalledWith("job_run_finish", {
      p_id: 8,
      p_ok: true,
      p_error_code: null,
      p_items: 0,
    });
  });

  it("any other job error is a generic 500 and is reported", async () => {
    jobSpy.mockRejectedValue(new Error("db down"));
    const response = await route.POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    const payload = await body(response);
    expect(JSON.stringify(payload)).not.toContain("db down");
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("withCron", () => {
  it("answers anything but POST with 405 before reading the secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const handler = vi.fn();
    const response = await withCron(
      { job: "extract", countItems: () => 0 },
      handler,
    )(new Request(URL_, { method: "GET" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(handler).not.toHaveBeenCalled();
  });

  it("the route exports POST only", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration"]);
  });
});

describe("time limits", () => {
  it("maxDuration equals the constant and nests inside the timeout and lease", () => {
    expect(route.maxDuration).toBe(EXTRACT_MAX_DURATION_S);
    expect(EXTRACTION_LEASE_SECONDS).toBeGreaterThan(EXTRACT_MAX_DURATION_S);
    expect(EXTRACTION_TIMEOUT_MS).toBeLessThan(EXTRACT_MAX_DURATION_S * 1000);
  });
});
