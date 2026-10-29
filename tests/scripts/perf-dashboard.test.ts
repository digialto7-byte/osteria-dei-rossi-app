import { describe, expect, it } from "vitest";
import { OWNER_LOCAL_EMAIL } from "../../scripts/lib/demo/fixture";
import {
  DEFAULT_ITERATIONS,
  DEMO_OWNER_EMAIL,
  LOCAL_ONLY_SENTENCE,
  assertLocalTarget,
  measure,
  provisionOwner,
  renderReport,
  run,
  runGuarded,
  type DashboardPorts,
  type Reply,
} from "../../scripts/lib/perf-dashboard";

// The dashboard's server-side p95 measurement (owner dashboard plan §5 step 15) with every port faked: no network, no clock,
// no secret key. The script reports numbers and promises none; it never fails on a number.

const SUPABASE = "http://127.0.0.1:54321";
const APP = "http://127.0.0.1:3000";
const OWNER_ID = "a0000000-0000-4000-8000-0000000000aa";

describe("assertLocalTarget", () => {
  it.each([
    [SUPABASE, APP],
    ["http://localhost:54321", "http://localhost:3000"],
    [SUPABASE, "http://localhost:3000/some/path?x=1"],
  ])("accepts %s with %s and returns the app's origin only", (supabaseUrl, baseUrl) => {
    const { baseOrigin } = assertLocalTarget({ supabaseUrl, baseUrl });
    expect(baseOrigin).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):3000$/);
  });

  it.each([
    ["staging Supabase", "https://abcdefghijklmnopqrst.supabase.co", APP],
    ["a staging app", SUPABASE, "https://staging-app.example.test"],
    ["a LAN address", SUPABASE, "http://192.168.1.20:3000"],
    ["a look-alike host", SUPABASE, "http://127.0.0.1.evil.test:3000"],
    ["credentials in the app URL", SUPABASE, "http://user:secret@127.0.0.1:3000"],
    ["credentials in the Supabase URL", "http://user:secret@127.0.0.1:54321", APP],
    ["a URL that is not one", SUPABASE, "not a url"],
    ["an empty Supabase URL", "", APP],
    ["another scheme", SUPABASE, "ftp://127.0.0.1:3000"],
  ])("refuses %s, and the message repeats nothing it was given", (_label, supabaseUrl, baseUrl) => {
    let message = "";
    try {
      assertLocalTarget({ supabaseUrl, baseUrl });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(LOCAL_ONLY_SENTENCE);
    for (const part of [supabaseUrl, baseUrl, "secret", "evil"]) {
      if (part) expect(message).not.toContain(part);
    }
  });
});

// --- fakes ------------------------------------------------------------------------------------------------------------------

interface World {
  calls: string[];
  inFlight: number;
  maxInFlight: number;
  passwordSet: string | null;
  signedInWith: string | null;
  ownerExists: boolean;
  me: { status: number; json: unknown };
  dashboard: (n: number) => Reply;
  clock: number;
}

const ME_OK = {
  status: 200,
  json: { user: { role: "owner" }, tenant: { id: "t", name: "Osteria Demo", isDemo: true } },
};

function world(over: Partial<World> = {}): World {
  return {
    calls: [],
    inFlight: 0,
    maxInFlight: 0,
    passwordSet: null,
    signedInWith: null,
    ownerExists: true,
    me: ME_OK,
    clock: 0,
    dashboard: (n) => ({
      status: 200,
      json: {},
      ms: 100 + n,
      serverTiming: `auth;dur=${10 + n}, rpc;dur=${50 + n}, total;dur=${70 + n}`,
    }),
    ...over,
  };
}

function ports(w: World): DashboardPorts {
  let n = 0;
  return {
    admin: {
      findUserId: async () => (w.ownerExists ? OWNER_ID : null),
      setPassword: async (_id, password) => {
        w.passwordSet = password;
      },
    },
    signIn: async (_email, password) => {
      w.signedInWith = password;
    },
    request: async (path) => {
      w.calls.push(path);
      if (path === "/api/me") return { ...w.me, ms: 1, serverTiming: null };
      w.inFlight += 1;
      w.maxInFlight = Math.max(w.maxInFlight, w.inFlight);
      await Promise.resolve();
      w.inFlight -= 1;
      n += 1;
      return w.dashboard(n);
    },
    newPassword: () => "fake-password-value",
  };
}

describe("provisionOwner", () => {
  it("looks for the owner that npm run demo creates", () => {
    expect(DEMO_OWNER_EMAIL).toBe(OWNER_LOCAL_EMAIL);
  });

  it("resets the demo owner's password, signs in with it and checks it is a demo tenant", async () => {
    const w = world();
    await provisionOwner(ports(w));
    expect(w.passwordSet).toBe("fake-password-value");
    expect(w.signedInWith).toBe("fake-password-value");
    expect(w.calls).toEqual(["/api/me"]);
  });

  it("stops when the demo owner does not exist, and asks for npm run demo", async () => {
    const w = world({ ownerExists: false });
    await expect(provisionOwner(ports(w))).rejects.toThrow(/npm run demo/);
    expect(w.signedInWith).toBeNull();
    expect(w.calls).toEqual([]);
  });

  it.each([
    [
      "a tenant that is not a demo tenant",
      { user: { role: "owner" }, tenant: { id: "t", name: "Osteria", isDemo: false } },
    ],
    [
      "a user who is not the owner",
      { user: { role: "chef" }, tenant: { id: "t", name: "x", isDemo: true } },
    ],
    ["a reply without a tenant", { user: { role: "owner" } }],
  ])("refuses %s before any dashboard request", async (_label, json) => {
    const w = world({ me: { status: 200, json } });
    await expect(provisionOwner(ports(w))).rejects.toThrow(/^Setup:/);
    expect(w.calls).toEqual(["/api/me"]);
  });

  it("refuses when /api/me does not answer 200", async () => {
    const w = world({ me: { status: 403, json: {} } });
    await expect(provisionOwner(ports(w))).rejects.toThrow(/403/);
  });
});

describe("measure", () => {
  it("makes DEFAULT_ITERATIONS (100) sequential GET /api/dashboard requests and nothing else", async () => {
    expect(DEFAULT_ITERATIONS).toBe(100);
    const w = world();
    const samples = await measure(ports(w), DEFAULT_ITERATIONS);
    expect(w.calls).toEqual(Array(100).fill("/api/dashboard"));
    expect(w.maxInFlight).toBe(1);
    expect(samples.wall).toHaveLength(100);
    expect(samples.errors).toBe(0);
    expect(samples.parts.auth).toHaveLength(100);
    expect(samples.parts.rpc?.[0]).toBe(51);
  });

  it("counts a non-2xx answer as an error and keeps measuring", async () => {
    const w = world({
      dashboard: (n) => ({
        status: n % 4 === 0 ? 500 : 200,
        json: null,
        ms: 10,
        serverTiming: null,
      }),
    });
    const samples = await measure(ports(w), 20);
    expect(samples.errors).toBe(5);
    expect(samples.wall).toHaveLength(20);
  });
});

describe("renderReport", () => {
  const samples = {
    wall: Array.from({ length: 100 }, (_, i) => i + 1),
    errors: 2,
    parts: {
      auth: Array.from({ length: 100 }, (_, i) => i + 1),
      rpc: Array.from({ length: 100 }, (_, i) => (i + 1) * 2),
      total: Array.from({ length: 100 }, (_, i) => (i + 1) * 3),
    },
  };

  it("reports p50, p95 and max of the wall time and of auth, rpc and total", () => {
    const text = renderReport(samples, { iterations: 100 });
    expect(text).toContain("| 100 | 2 | 50.0 | 95.0 | 100.0 |");
    expect(text).toContain("50.0 / 95.0");
    expect(text).toContain("100.0 / 190.0");
    expect(text).toContain("150.0 / 285.0");
  });

  it("says it was measured locally on demo data and promises nothing", () => {
    const text = renderReport(samples, { iterations: 100 });
    expect(text).toContain("Misurato in locale sui dati di prova, non da un telefono in 4G");
    expect(text).toMatch(/Nessun valore è una promessa/);
  });

  it("prints a dash for a part the server did not send", () => {
    const text = renderReport({ wall: [5, 6], errors: 0, parts: {} }, { iterations: 2 });
    expect(text).toContain("– / –");
  });
});

describe("run", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      options: {
        iterations: 10,
        write: (t: string) => void out.push(t),
        writeError: (t: string) => void err.push(t),
      },
    };
  };

  it("sets up, measures, prints the report and exits 0", async () => {
    const w = world();
    const { out, err, options } = io();
    expect(await run(ports(w), options)).toBe(0);
    expect(out.join("\n")).toContain("Misurato in locale");
    expect(err).toEqual([]);
    expect(w.calls.filter((c) => c === "/api/dashboard")).toHaveLength(10);
  });

  it("exits 0 whatever the numbers are, even when every request fails or is very slow", async () => {
    const w = world({
      dashboard: () => ({ status: 500, json: null, ms: 99_999, serverTiming: null }),
    });
    const { out, options } = io();
    expect(await run(ports(w), options)).toBe(0);
    expect(out.join("\n")).toContain("99999.0");
  });

  it("exits 1 only when the setup cannot be done, with a fixed sentence and no report", async () => {
    const w = world({ ownerExists: false });
    const { out, err, options } = io();
    expect(await run(ports(w), options)).toBe(1);
    expect(out).toEqual([]);
    expect(err.join(" ")).toMatch(/^Setup:/);
  });

  it("an unexpected error prints a generic sentence, nothing from the error", async () => {
    const w = world();
    const broken = ports(w);
    broken.signIn = async () => {
      throw new Error("token=abc123 for owner@example.test");
    };
    const { err, options } = io();
    expect(await run(broken, options)).toBe(1);
    expect(err.join(" ")).not.toMatch(/abc123|owner@example/);
  });

  it("never prints the email, the password or a token", async () => {
    const w = world();
    const { out, options } = io();
    await run(ports(w), options);
    const text = out.join("\n");
    expect(text).not.toMatch(/fake-password-value|@example\.test|eyJ|Bearer|cookie/i);
  });
});

describe("runGuarded", () => {
  it("builds no ports and makes no request when the target is refused", async () => {
    let built = 0;
    const errors: string[] = [];
    const code = await runGuarded({
      supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
      baseUrl: APP,
      makePorts: () => {
        built += 1;
        return ports(world());
      },
      iterations: 3,
      write: () => {},
      writeError: (t) => void errors.push(t),
    });
    expect(code).toBe(1);
    expect(built).toBe(0);
    expect(errors).toEqual([LOCAL_ONLY_SENTENCE]);
  });

  it("passes the origin to makePorts and runs when the target is local", async () => {
    const w = world();
    let origin = "";
    const out: string[] = [];
    const code = await runGuarded({
      supabaseUrl: SUPABASE,
      baseUrl: `${APP}/x?y=1`,
      makePorts: (o) => {
        origin = o;
        return ports(w);
      },
      iterations: 3,
      write: (t) => void out.push(t),
      writeError: () => {},
    });
    expect(code).toBe(0);
    expect(origin).toBe(APP);
    expect(w.calls.filter((c) => c === "/api/dashboard")).toHaveLength(3);
  });
});
