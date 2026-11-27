import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { ME_SETTINGS } from "../../helpers/me-data";

// SP2 S6 (docs/plans/2026-11-26-sp02-memberships.md §3.4, lead ruling 2026-11-27): GET /api/me reads its row by the token's tenant as well as by the
// login (belt and braces: a later policy change cannot make maybeSingle see two memberships). Its reply does NOT change: no tenantCount (the
// switcher asks GET /api/me/tenants), so the full-body pins and the offline-cached payload stay as they are.
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const me = await import("@/app/api/me/route");
const ROW = {
  id: "a1000000-0000-4000-8000-00000000000a",
  display_name: "Titolare Demo",
  role: "owner",
  tenant: { id: OWNER_CLAIMS.tenant_id, name: "Osteria Demo", demo_data_since: null },
};
const call = () => me.GET(new Request("http://localhost:3000/api/me"));

beforeEach(() => {
  client = fakeSupabase({ claims: claimsFor("owner"), meRow: ROW });
});

describe("GET /api/me with memberships in several tenants (SP2 S6)", () => {
  it("reads the app_user row of the token's tenant and login", async () => {
    expect((await call()).status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("app_user");
    expect(client.query.eq).toHaveBeenCalledWith("auth_id", OWNER_CLAIMS.sub);
    expect(client.query.eq).toHaveBeenCalledWith("tenant_id", OWNER_CLAIMS.tenant_id);
  });

  it("answers the same keys as before: no tenantCount, no membership list", async () => {
    const json = await (await call()).json();
    expect(Object.keys(json).sort()).toEqual(["settings", "tenant", "user"]);
    expect(json.settings).toEqual(ME_SETTINGS);
    expect(client.rpc).not.toHaveBeenCalledWith("my_memberships");
  });
});
