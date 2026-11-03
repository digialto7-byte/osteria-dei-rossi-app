import { describe, expect, it } from "vitest";
import { checkHeaders, type CheckedPath, type Expect } from "@/lib/security/header-check";
import { buildCsp } from "@/lib/security/csp";

// AT2 (M25 step 3): the header rules of ADR-028, on header sets only (no network).
const ORIGIN = "https://abc.supabase.co";
const N1 = Buffer.alloc(16, 1).toString("base64");
const N2 = Buffer.alloc(16, 2).toString("base64");
const N12 = Buffer.alloc(12, 3).toString("base64");

const pageCsp = (nonce: string) =>
  buildCsp({ supabaseOrigin: ORIGIN, deployment: "production", dev: false, nonce: nonce });
const staticCsp = buildCsp({
  supabaseOrigin: ORIGIN,
  deployment: "production",
  dev: false,
  nonce: null,
});
const HSTS = "max-age=63072000; includeSubDomains";

function headers(csp: string | null, extra: Record<string, string | null> = {}): Headers {
  const base: Record<string, string | null> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "strict-transport-security": HSTS,
    "content-security-policy": csp,
    ...extra,
  };
  const h = new Headers();
  for (const [k, v] of Object.entries(base)) if (v !== null) h.set(k, v);
  return h;
}

type Replies = Parameters<typeof checkHeaders>[0];
function good(): Replies {
  return {
    "/login": [headers(pageCsp(N1)), headers(pageCsp(N2))],
    "/api/health": headers(staticCsp),
    "/sw.js": headers(staticCsp),
  };
}
const run = (replies: Replies, expectation: Expect = "production") =>
  checkHeaders(replies, expectation);
const problems = (replies: Replies, expectation: Expect = "production") =>
  run(replies, expectation).findings.map((f) => `${f.path} ${f.header} ${f.problem}`);

describe("checkHeaders: the good set", () => {
  it("a complete production set has no findings and one note", () => {
    expect(run(good())).toEqual({
      findings: [],
      notes: ["style-src unsafe-inline (ADR-028)"],
    });
  });
});

describe("checkHeaders: presence and shape of the CSP", () => {
  it.each(["/api/health", "/sw.js"] as const)("%s without a CSP is csp_missing", (path) => {
    const replies = good();
    replies[path] = headers(null);
    expect(run(replies).findings).toContainEqual({
      path,
      header: "content-security-policy",
      problem: "csp_missing",
    });
  });

  it("a /login reply without a CSP is csp_missing", () => {
    const replies = good();
    replies["/login"] = [headers(null), headers(pageCsp(N2))];
    expect(problems(replies)).toContain("/login content-security-policy csp_missing");
  });

  it("two policies merged by the runtime (', ') is multiple_csp", () => {
    const replies = good();
    replies["/api/health"] = headers(`${staticCsp}, ${staticCsp}`);
    expect(problems(replies)).toContain("/api/health content-security-policy multiple_csp");
  });
});

describe("checkHeaders: /login carries a nonce policy", () => {
  const withLogin = (csp: string): Replies => ({
    ...good(),
    "/login": [headers(csp), headers(pageCsp(N2))],
  });

  it("no nonce is a finding", () => {
    const csp = pageCsp(N1).replace(` 'nonce-${N1}'`, "");
    expect(run(withLogin(csp)).findings.length).toBeGreaterThan(0);
  });

  it("'unsafe-inline' added to script-src is a finding", () => {
    const csp = pageCsp(N1).replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    expect(problems(withLogin(csp)).join("\n")).toContain("script_unsafe_inline");
  });

  it("no 'strict-dynamic' is a finding", () => {
    const csp = pageCsp(N1).replace(" 'strict-dynamic'", "");
    expect(run(withLogin(csp)).findings.length).toBeGreaterThan(0);
  });

  it("the same nonce on both fetches is nonce_reused", () => {
    const replies = {
      ...good(),
      "/login": [headers(pageCsp(N1)), headers(pageCsp(N1))],
    } as Replies;
    expect(problems(replies)).toContain("/login content-security-policy nonce_reused");
  });

  it("a 12-byte nonce is nonce_short", () => {
    const csp = pageCsp(N1).replace(N1, N12);
    expect(problems(withLogin(csp))).toContain("/login content-security-policy nonce_short");
  });
});

describe("checkHeaders: /api/health and /sw.js carry the static policy", () => {
  it.each(["/api/health", "/sw.js"] as const)("%s with a nonce is a finding", (path) => {
    const replies = good();
    replies[path] = headers(pageCsp(N1));
    expect(run(replies).findings.some((f) => f.path === path)).toBe(true);
  });

  it.each(["/api/health", "/sw.js"] as const)(
    "%s with 'unsafe-inline' in script-src is a finding",
    (path) => {
      const replies = good();
      replies[path] = headers(
        staticCsp.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      );
      expect(run(replies).findings.some((f) => f.path === path)).toBe(true);
    },
  );
});

describe("checkHeaders: directives that must hold on every path", () => {
  const mutate = (path: CheckedPath, fn: (csp: string) => string): Replies => {
    const replies = good();
    if (path === "/login") {
      replies["/login"] = [headers(fn(pageCsp(N1))), headers(pageCsp(N2))];
    } else {
      replies[path] = headers(fn(staticCsp));
    }
    return replies;
  };

  it("'unsafe-eval' anywhere is a finding", () => {
    expect(
      run(
        mutate("/sw.js", (c) => c.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")),
      ).findings.length,
    ).toBeGreaterThan(0);
    expect(
      run(mutate("/login", (c) => `${c}; style-src 'self' 'unsafe-eval'`)).findings.length,
    ).toBeGreaterThan(0);
  });

  it("an origin in script-src is a finding", () => {
    const replies = mutate("/sw.js", (c) =>
      c.replace("script-src 'self'", "script-src 'self' https://cdn.example"),
    );
    expect(run(replies).findings.length).toBeGreaterThan(0);
  });

  it("connect-src * is a finding", () => {
    const replies = mutate("/api/health", (c) => c.replace("connect-src 'self'", "connect-src *"));
    expect(run(replies).findings.length).toBeGreaterThan(0);
  });

  it("no frame-ancestors is a finding", () => {
    const replies = mutate("/api/health", (c) => c.replace("; frame-ancestors 'none'", ""));
    expect(run(replies).findings.length).toBeGreaterThan(0);
  });

  it("no object-src 'none' is a finding", () => {
    const replies = mutate("/api/health", (c) => c.replace("; object-src 'none'", ""));
    expect(run(replies).findings.length).toBeGreaterThan(0);
  });

  it("a missing nosniff, Referrer-Policy or X-Frame-Options on /sw.js is one finding each", () => {
    for (const name of ["x-content-type-options", "referrer-policy", "x-frame-options"]) {
      const replies = good();
      replies["/sw.js"] = headers(staticCsp, { [name]: null });
      expect(run(replies).findings).toEqual([{ path: "/sw.js", header: name, problem: "missing" }]);
    }
  });
});

describe("checkHeaders: HSTS (production only)", () => {
  const withoutHsts = (value: string | null): Replies => {
    const extra = { "strict-transport-security": value };
    return {
      "/login": [headers(pageCsp(N1), extra), headers(pageCsp(N2), extra)],
      "/api/health": headers(staticCsp, extra),
      "/sw.js": headers(staticCsp, extra),
    };
  };

  it("production without HSTS is one finding per path", () => {
    const found = run(withoutHsts(null)).findings;
    expect(found.map((f) => f.path).sort()).toEqual(["/api/health", "/login", "/sw.js"]);
    expect(found.every((f) => f.header === "strict-transport-security")).toBe(true);
  });

  it("max-age=86400 is a finding", () => {
    expect(run(withoutHsts("max-age=86400; includeSubDomains")).findings.length).toBe(3);
  });

  it("no includeSubDomains is a finding", () => {
    expect(run(withoutHsts("max-age=63072000")).findings.length).toBe(3);
  });

  it("31 536 000 with includeSubDomains passes", () => {
    expect(run(withoutHsts("max-age=31536000; includeSubDomains")).findings).toEqual([]);
  });

  it.each(["preview", "local"] as const)("%s without HSTS has no finding", (expectation) => {
    expect(run(withoutHsts(null), expectation).findings).toEqual([]);
  });
});
