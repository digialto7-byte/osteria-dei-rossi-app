import { describe, expect, it } from "vitest";
import {
  COLD_WARM_LOADS,
  REAL_PHONE_SENTENCE,
  SLOW_4G,
  STAGING_ONLY_SENTENCE,
  assertStagingTarget,
  measure,
  addBypassRoute,
  type RoutableContext,
  renderReport,
  run,
  type Perf4gPorts,
} from "../../scripts/lib/perf-4g";

// AT7's evidence (M22 plan §5 step 18): the dashboard's "Ieri" tile on Slow 4G, from a GitHub runner, against the staging app. Every
// port is faked here: no browser, no network, no clock, no secret. It reports numbers and promises none; the exit code is 0 whatever
// they are. Nothing is printed that came from a reply, a cookie or a key.

const REF = "abcdefghijklmnopqrst";
const SUPABASE = `https://${REF}.supabase.co`;
const APP = "https://staging.example.test";
const HOST = "staging.example.test";

describe("SLOW_4G", () => {
  it("is Chrome's Slow 4G preset: 150 ms, 1.6 Mbps down, 750 Kbps up, in bytes per second", () => {
    expect(SLOW_4G).toEqual({
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
  });
});

describe("assertStagingTarget", () => {
  it("accepts the staging project with the staging app host and returns the app's origin only", () => {
    expect(
      assertStagingTarget({
        supabaseUrl: SUPABASE,
        baseUrl: `${APP}/some/path?x=1`,
        stagingRef: REF,
        stagingAppHost: HOST,
      }),
    ).toEqual({ baseOrigin: APP });
  });

  it.each([
    ["another Supabase project", "https://zzzzzzzzzzzzzzzzzzzz.supabase.co", APP],
    ["a look-alike Supabase host", `https://${REF}.supabase.co.evil.test`, APP],
    ["http Supabase", `http://${REF}.supabase.co`, APP],
    ["another app host", SUPABASE, "https://other.example.test"],
    ["a look-alike app host", SUPABASE, `https://${HOST}.evil.test`],
    ["a suffix app host", SUPABASE, `https://evil-${HOST}`],
    ["an app host with a port", SUPABASE, `https://${HOST}:8443`],
    ["http app", SUPABASE, `http://${HOST}`],
    ["credentials in the app URL", SUPABASE, `https://user:secret@${HOST}`],
    ["not a URL", SUPABASE, "not a url"],
    ["localhost", SUPABASE, "http://127.0.0.1:3000"],
  ])("refuses %s, and the message repeats nothing it was given", (_label, supabaseUrl, baseUrl) => {
    let message = "";
    try {
      assertStagingTarget({ supabaseUrl, baseUrl, stagingRef: REF, stagingAppHost: HOST });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(STAGING_ONLY_SENTENCE);
    for (const part of [supabaseUrl, baseUrl, "secret", "evil"]) {
      if (part) expect(message).not.toContain(part);
    }
  });

  it("refuses an unset staging ref or app host", () => {
    expect(() =>
      assertStagingTarget({
        supabaseUrl: SUPABASE,
        baseUrl: APP,
        stagingRef: "",
        stagingAppHost: HOST,
      }),
    ).toThrow(STAGING_ONLY_SENTENCE);
    expect(() =>
      assertStagingTarget({
        supabaseUrl: SUPABASE,
        baseUrl: APP,
        stagingRef: REF,
        stagingAppHost: "",
      }),
    ).toThrow(STAGING_ONLY_SENTENCE);
  });
});

// --- fakes ------------------------------------------------------------------------------------------------------------------

function fakePorts(overrides: Partial<Perf4gPorts> = {}) {
  const calls: string[] = [];
  const cold = Array.from({ length: COLD_WARM_LOADS }, (_, i) => 3000 + i * 10);
  const warm = Array.from({ length: COLD_WARM_LOADS }, (_, i) => 1000 + i * 10);
  const ports: Perf4gPorts = {
    provisionOwner: async () => void calls.push("provision"),
    load: async (mode) => {
      calls.push(mode);
      const next = (mode === "cold" ? cold : warm).shift();
      return next ?? null;
    },
    ...overrides,
  };
  return { ports, calls };
}

describe("measure", () => {
  it("runs 20 cold and 20 warm loads, and counts a tile that never showed as a failure", async () => {
    let n = 0;
    const { ports, calls } = fakePorts({
      load: async (mode) => {
        calls.push(mode);
        n += 1;
        return n === 3 ? null : 100 + n;
      },
    });
    const samples = await measure(ports);
    expect(calls.filter((c) => c === "cold")).toHaveLength(20);
    expect(calls.filter((c) => c === "warm")).toHaveLength(20);
    expect(samples.cold).toHaveLength(19);
    expect(samples.coldFailures).toBe(1);
    expect(samples.warm).toHaveLength(20);
    expect(samples.warmFailures).toBe(0);
  });
});

describe("renderReport", () => {
  it("prints p50, p95 and max for cold and warm, and says what the measurement is not", async () => {
    const { ports } = fakePorts();
    const text = renderReport(await measure(ports));
    expect(text).toContain(REAL_PHONE_SENTENCE);
    expect(REAL_PHONE_SENTENCE).toBe(
      "Misurato su staging con rete simulata Slow 4G (Chromium), non da un telefono reale",
    );
    expect(text).toMatch(
      /\| Primo caricamento \(a freddo\) \| 20 \| 0 \| 3090\.0 \| 3180\.0 \| 3190\.0 \|/,
    );
    expect(text).toMatch(
      /\| Caricamenti successivi \(a caldo\) \| 20 \| 0 \| 1090\.0 \| 1180\.0 \| 1190\.0 \|/,
    );
  });

  it("prints dashes when nothing could be measured, and never a comparison with the target", () => {
    const text = renderReport({ cold: [], warm: [], coldFailures: 20, warmFailures: 20 });
    expect(text).toContain("| – | – | – |");
    expect(text).not.toMatch(/superato|raggiunto|PASS|FAIL|OK/);
  });
});

describe("run", () => {
  it("provisions, measures, prints the report and returns 0", async () => {
    const { ports, calls } = fakePorts();
    const out: string[] = [];
    const code = await run(ports, { write: (t) => out.push(t) });
    expect(code).toBe(0);
    expect(calls[0]).toBe("provision");
    expect(out.join("\n")).toContain("p95");
  });

  it("returns 0 whatever the numbers are, even when every load failed", async () => {
    const { ports } = fakePorts({ load: async () => null });
    const out: string[] = [];
    expect(await run(ports, { write: (t) => out.push(t) })).toBe(0);
    expect(out.join("\n")).toContain("–");
  });

  it("returns 1 with a fixed sentence when the setup fails, printing nothing to the report", async () => {
    const { ports } = fakePorts({
      provisionOwner: async () => {
        throw new Error("boom with secret-token and owner@example.test");
      },
    });
    const out: string[] = [];
    const errors: string[] = [];
    const code = await run(ports, { write: (t) => out.push(t), writeError: (t) => errors.push(t) });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(errors.join("")).not.toMatch(/secret-token|owner@example/);
  });

  it("puts no e-mail address, cookie or key in the report", async () => {
    const { ports } = fakePorts();
    const out: string[] = [];
    await run(ports, { write: (t) => out.push(t) });
    expect(out.join("\n")).not.toMatch(/@|sb-|cookie|eyJ|https?:\/\//i);
  });
});

describe("addBypassRoute (V1.1: the bypass secret goes to the app origin only)", () => {
  const SECRET = "bypass-not-a-secret";
  type Handler = Parameters<RoutableContext["route"]>[1];
  type Cont = { headers?: Record<string, string> } | undefined;

  function fakeContext() {
    const routes: { pattern: unknown; handler: Handler }[] = [];
    return {
      routes,
      context: {
        route: async (pattern: unknown, handler: Handler) => {
          routes.push({ pattern, handler });
        },
      },
    };
  }

  async function send(
    routes: ReturnType<typeof fakeContext>["routes"],
    url: string,
    own: Record<string, string> = { accept: "text/html" },
  ): Promise<Cont> {
    let out: Cont = { headers: { never: "called" } };
    const route = {
      request: () => ({ url: () => url, headers: () => own }),
      continue: async (options?: Cont) => {
        out = options;
      },
    };
    await routes[0]!.handler(route);
    return out;
  }

  it("adds the header to requests to the app origin, keeping the request's own headers", async () => {
    const { context, routes } = fakeContext();
    await addBypassRoute(context, APP, { VERCEL_AUTOMATION_BYPASS_SECRET: SECRET });
    expect(routes).toHaveLength(1);
    expect((await send(routes, `${APP}/api/me`))?.headers).toEqual({
      accept: "text/html",
      "x-vercel-protection-bypass": SECRET,
    });
  });

  it("sends nothing extra to Supabase or any other origin, nor to a look-alike host", async () => {
    const { context, routes } = fakeContext();
    await addBypassRoute(context, APP, { VERCEL_AUTOMATION_BYPASS_SECRET: SECRET });
    for (const url of [
      "https://abc.supabase.co/rest/v1/x",
      "https://staging.example.test.evil.test/",
      "http://staging.example.test/",
      "https://staging.example.test:8443/",
    ]) {
      expect(await send(routes, url), url).toBeUndefined();
    }
  });

  it("registers no route at all when the secret is unset or blank", async () => {
    const { context, routes } = fakeContext();
    await addBypassRoute(context, APP, {});
    await addBypassRoute(context, APP, { VERCEL_AUTOMATION_BYPASS_SECRET: "  " });
    expect(routes).toHaveLength(0);
  });
});
