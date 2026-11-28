import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORM_API_SCHEMAS } from "@/lib/platform/api";
import {
  dataRpcCalls,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

// SP3 step 17 (docs/plans/2026-11-15-sp3-console.md §3.4.5): the console's reads and writes. Each calls exactly one console function (which runs
// app.require_console first), parses its reply with the src/lib/platform/api.ts schema, and maps the database's answers to the listed errors.
let client: FakeSupabase;
const reportError = vi.fn();
let appOrigin: string | undefined = "https://app.example.test";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  readAppOrigin: () => appOrigin,
}));

const me = await import("@/app/api/platform/me/route");
const tenants = await import("@/app/api/platform/tenants/route");
const tenant = await import("@/app/api/platform/tenants/[id]/route");
const open = await import("@/app/api/platform/tenants/[id]/open/route");
const audit = await import("@/app/api/platform/audit/route");
const notices = await import("@/app/api/platform/notices/route");
const notified = await import("@/app/api/platform/notices/[id]/notified/route");

const STAFF = "a7000000-0000-4000-8000-000000000001";
const CONSOLE = {
  sub: STAFF,
  role: "platform_staff",
  session_id: "c7000000-0000-4000-8000-000000000001",
  aal: "aal2",
};
const TENANT = "a0000000-0000-4000-8000-00000000000a";
const NOTICE = "f0000000-0000-4000-8000-00000000000f";
const BASE = "http://127.0.0.1:3000/api/platform";
const ex = PLATFORM_API_SCHEMAS;
const codeOf = async (response: Response) => (await response.json()).error.code as string;
const ok = (data: unknown) => [{ data, error: null }];
const fail = (code: string, message: string) => [{ data: null, error: { code, message } }];
const getReq = (path: string) => new Request(`${BASE}${path}`);

beforeEach(() => {
  reportError.mockReset();
  appOrigin = "https://app.example.test";
});

describe("the reads answer the documented shapes", () => {
  it("GET /api/platform/me calls platform_me", async () => {
    client = fakeSupabase({ claims: CONSOLE, rpc: { platform_me: ok(ex.meResponse.example) } });
    const response = await me.GET(getReq("/me"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ex.meResponse.example);
    expect(dataRpcCalls(client, 0)).toEqual([["platform_me"]]);
  });

  it("GET /api/platform/tenants calls platform_tenants and wraps its list", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_tenants: ok(ex.tenantsResponse.example.tenants) },
    });
    const response = await tenants.GET(getReq("/tenants"));
    expect(await response.json()).toEqual(ex.tenantsResponse.example);
    expect(dataRpcCalls(client, 0)).toEqual([["platform_tenants"]]);
  });

  it("GET /api/platform/tenants/[id] calls platform_tenant with the id", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_tenant: ok(ex.tenantDetailResponse.example) },
    });
    const response = await tenant.GET(getReq(`/tenants/${TENANT}`), routeContext({ id: TENANT }));
    expect(await response.json()).toEqual(ex.tenantDetailResponse.example);
    expect(dataRpcCalls(client, 0)).toEqual([["platform_tenant", { p_tenant: TENANT }]]);
  });

  it("GET /api/platform/notices calls platform_notices and wraps its list", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_notices: ok(ex.noticesResponse.example.notices) },
    });
    expect(await (await notices.GET(getReq("/notices"))).json()).toEqual(
      ex.noticesResponse.example,
    );
  });

  it("a reply with an unknown key (a cost) is a 500 and is not echoed", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_tenants: ok([{ ...ex.tenantsResponse.example.tenants[0], unitCost: 3.2 }]) },
    });
    const response = await tenants.GET(getReq("/tenants"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("3.2");
  });

  it("a reply holding an @ in an audit detail is a 500", async () => {
    const row = { ...ex.auditResponse.example.rows[0], detail: { who: "someone@example.test" } };
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_audit: ok({ rows: [row], nextBefore: null }) },
    });
    const response = await audit.GET(getReq("/audit?dal=2026-10-16&al=2026-11-15"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("@");
  });
});

describe("GET /api/platform/audit", () => {
  it("passes the days, the venue, the action and the cursor to platform_audit", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_audit: ok(ex.auditResponse.example) },
    });
    const response = await audit.GET(
      getReq(
        `/audit?dal=2026-10-16&al=2026-11-15&locale=${TENANT}&azione=console.entered&prima=41`,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ex.auditResponse.example);
    expect(dataRpcCalls(client, 0)).toEqual([
      [
        "platform_audit",
        {
          p_from: "2026-10-16",
          p_to: "2026-11-15",
          p_tenant: TENANT,
          p_action: "console.entered",
          p_before: 41,
        },
      ],
    ]);
  });

  it("the optional filters are null when absent", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_audit: ok({ rows: [], nextBefore: null }) },
    });
    await audit.GET(getReq("/audit?dal=2026-11-15&al=2026-11-15"));
    expect(dataRpcCalls(client, 0)).toEqual([
      [
        "platform_audit",
        {
          p_from: "2026-11-15",
          p_to: "2026-11-15",
          p_tenant: null,
          p_action: null,
          p_before: null,
        },
      ],
    ]);
  });

  it.each([
    ["no dal", "/audit?al=2026-11-15"],
    ["no al", "/audit?dal=2026-11-15"],
    ["al before dal", "/audit?dal=2026-11-15&al=2026-11-14"],
    ["more than 366 days", "/audit?dal=2025-01-01&al=2026-11-15"],
    ["not a day", "/audit?dal=2026-02-30&al=2026-11-15"],
    ["an unknown action", "/audit?dal=2026-11-01&al=2026-11-15&azione=console.hacked"],
    ["a bad uuid", "/audit?dal=2026-11-01&al=2026-11-15&locale=nope"],
    ["an unknown parameter", "/audit?dal=2026-11-01&al=2026-11-15&limit=500"],
    ["a repeated parameter", "/audit?dal=2026-11-01&dal=2026-11-02&al=2026-11-15"],
    ["a bad cursor", "/audit?dal=2026-11-01&al=2026-11-15&prima=-1"],
  ])("%s is 400 invalid_request before any RPC", async (_name, path) => {
    client = fakeSupabase({ claims: CONSOLE });
    const response = await audit.GET(getReq(path));
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("invalid_request");
    expect(dataRpcCalls(client, 0)).toEqual([]);
  });

  it("the database's 22023 (a range it refuses) is 400 invalid_request", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_audit: fail("22023", "invalid_range") },
    });
    expect((await audit.GET(getReq("/audit?dal=2026-11-01&al=2026-11-15"))).status).toBe(400);
  });
});

describe("POST /api/platform/tenants/[id]/open", () => {
  const post = (id = TENANT) =>
    open.POST(jsonRequest(`${BASE}/tenants/${id}/open`, {}), routeContext({ id }));

  it("an attached venue: the URL of the app's chooser with the venue highlighted", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_open_tenant: ok({ tenantId: TENANT, attached: true }) },
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: `https://app.example.test/login/scegli-locale?locale=${TENANT}`,
    });
    expect(dataRpcCalls(client, 0)).toEqual([["platform_open_tenant", { p_tenant: TENANT }]]);
  });

  it("DigiAlto not attached: 409 digialto_not_attached", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_open_tenant: ok({ tenantId: TENANT, attached: false }) },
    });
    const response = await post();
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("digialto_not_attached");
  });

  it("without APP_ORIGIN: 500 before any RPC (nothing is written to the audit)", async () => {
    appOrigin = undefined;
    client = fakeSupabase({ claims: CONSOLE });
    expect((await post()).status).toBe(500);
    expect(dataRpcCalls(client, 0)).toEqual([]);
  });

  it("an unknown venue is 404 tenant_not_found; a malformed or uppercase id is 404 not_found before any RPC", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_open_tenant: fail("P0002", "tenant_not_found") },
    });
    let response = await post();
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe("tenant_not_found");
    for (const id of ["nope", TENANT.toUpperCase()]) {
      client = fakeSupabase({ claims: CONSOLE });
      response = await post(id);
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("not_found");
      expect(dataRpcCalls(client, 0)).toEqual([]);
    }
  });

  it("a body with a key is 400; a non-JSON body is 415", async () => {
    client = fakeSupabase({ claims: CONSOLE });
    expect(
      (
        await open.POST(
          jsonRequest(`${BASE}/tenants/${TENANT}/open`, { x: 1 }),
          routeContext({ id: TENANT }),
        )
      ).status,
    ).toBe(400);
    const plain = new Request(`${BASE}/tenants/${TENANT}/open`, { method: "POST", body: "{}" });
    expect((await open.POST(plain, routeContext({ id: TENANT }))).status).toBe(415);
  });
});

describe("POST /api/platform/notices/[id]/notified", () => {
  const post = (body: unknown, id = NOTICE) =>
    notified.POST(jsonRequest(`${BASE}/notices/${id}/notified`, body), routeContext({ id }));

  it("calls platform_notice_mark and answers its reply", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_notice_mark: ok(ex.noticeNotifiedResponse.example) },
    });
    const response = await post({ tenantId: TENANT });
    expect(await response.json()).toEqual(ex.noticeNotifiedResponse.example);
    expect(dataRpcCalls(client, 0)).toEqual([
      ["platform_notice_mark", { p_notice: NOTICE, p_tenant: TENANT }],
    ]);
  });

  it("unknown notice or venue: 404 notice_not_found and 404 tenant_not_found", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_notice_mark: fail("P0002", "notice_not_found") },
    });
    expect(await codeOf(await post({ tenantId: TENANT }))).toBe("notice_not_found");
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_notice_mark: fail("P0002", "tenant_not_found") },
    });
    expect(await codeOf(await post({ tenantId: TENANT }))).toBe("tenant_not_found");
  });

  it("a missing or uppercase tenantId is 400", async () => {
    client = fakeSupabase({ claims: CONSOLE });
    expect((await post({})).status).toBe(400);
    expect((await post({ tenantId: TENANT.toUpperCase() })).status).toBe(400);
  });
});

describe("the common platform errors (§3.4.1)", () => {
  const routes: [string, () => Promise<Response>][] = [
    ["me", () => me.GET(getReq("/me"))],
    ["tenants", () => tenants.GET(getReq("/tenants"))],
    ["tenant", () => tenant.GET(getReq(`/tenants/${TENANT}`), routeContext({ id: TENANT }))],
    ["audit", () => audit.GET(getReq("/audit?dal=2026-11-01&al=2026-11-15"))],
    ["notices", () => notices.GET(getReq("/notices"))],
    [
      "open",
      () =>
        open.POST(jsonRequest(`${BASE}/tenants/${TENANT}/open`, {}), routeContext({ id: TENANT })),
    ],
    [
      "notified",
      () =>
        notified.POST(
          jsonRequest(`${BASE}/notices/${NOTICE}/notified`, { tenantId: TENANT }),
          routeContext({ id: NOTICE }),
        ),
    ],
  ];
  const FN = [
    "platform_me",
    "platform_tenants",
    "platform_tenant",
    "platform_audit",
    "platform_notices",
    "platform_open_tenant",
    "platform_notice_mark",
  ];

  it.each(routes)(
    "%s: an authenticated token is 409 console_selection_required, before any RPC",
    async (_n, call) => {
      client = fakeSupabase({ claims: { ...CONSOLE, role: "authenticated" } });
      const response = await call();
      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("console_selection_required");
      expect(dataRpcCalls(client, 0)).toEqual([]);
    },
  );

  it.each(routes)(
    "%s: the database's answers map to 403 forbidden, mfa_factor_required and mfa_required",
    async (_n, call) => {
      for (const [code, message, apiCode] of [
        ["42501", "console_required", "forbidden"],
        ["P0001", "mfa_factor_required", "mfa_factor_required"],
        ["P0001", "mfa_required", "mfa_required"],
      ] as const) {
        client = fakeSupabase({
          claims: CONSOLE,
          rpc: Object.fromEntries(FN.map((f) => [f, fail(code, message)])),
        });
        const response = await call();
        expect(response.status).toBe(403);
        expect(await codeOf(response)).toBe(apiCode);
      }
    },
  );

  it.each(routes)(
    "%s: an unexpected database error is 500, reported by its code only",
    async (_n, call) => {
      client = fakeSupabase({
        claims: CONSOLE,
        rpc: Object.fromEntries(FN.map((f) => [f, fail("XX000", "Osteria Demo secret")])),
      });
      reportError.mockReset();
      expect((await call()).status).toBe(500);
      expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
      expect(String(reportError.mock.calls[0]?.[0])).not.toContain("Osteria");
    },
  );
});

describe("AT10: the platform server code never imports the admin client", () => {
  it("no file under src/server/platform or src/app/api/platform names the admin client or the secret key", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((e) => e.isFile() && e.name.endsWith(".ts"))
        .map((e) => join(e.parentPath, e.name));
    const all = [
      ...files(join(process.cwd(), "src/server/platform")),
      ...files(join(process.cwd(), "src/app/api/platform")),
    ];
    expect(all.length).toBeGreaterThanOrEqual(12);
    for (const file of all) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(
        /supabase\/admin|createAdminClient|SUPABASE_SECRET_KEY|staff-auth\/privileged/,
      );
    }
  });
});
