import { describe, expect, it, vi } from "vitest";
import { runAddOwner, type AddOwnerClient } from "../../scripts/lib/add-owner";

// SP3 PR 1 (lead decision 2026-11-27): scripts/add-owner.ts adds an e-mail owner login to an EXISTING tenant. It creates the auth user (e-mail, confirmed, no
// password) or reuses one that is a member nowhere, inserts the owner row, then writes one platform audit row through the shared helper. It prints only
// 8-character id prefixes and never the address. Fake data only.
const EMAIL = "new.owner@example.test";
const TENANT = "1111aaaa-1111-4111-8111-111111111111";
const AUTH = "a7000000-0000-4000-8000-000000000001";
const MEMBER = "b7000000-0000-4000-8000-000000000001";
const ARGS = ["--tenant", TENANT, "--email", EMAIL, "--name", "Titolare Demo"];

type Err = { message: string; code?: string } | null;
type User = { id: string; email?: string | null };
interface Setup {
  tenant?: { data: unknown; error: Err };
  users?: User[];
  listError?: { message: string; code?: string };
  memberships?: { data: unknown; error: Err };
  create?: { data: { user: { id: string } | null }; error: Err };
  insert?: { data: unknown; error: Err };
  deleteError?: { message: string; code?: string };
  audit?: { data: unknown; error: Err };
  auditThrows?: boolean;
}

function harness(setup: Setup = {}) {
  const calls: string[] = [];
  const listUsers = vi.fn(async (_p: { page: number; perPage: number }) => {
    calls.push("listUsers");
    return setup.listError
      ? { data: { users: [] as User[] }, error: setup.listError as Err }
      : { data: { users: setup.users ?? [] }, error: null as Err };
  });
  const createUser = vi.fn(async (_a: { email: string; email_confirm: boolean }) => {
    calls.push("createUser");
    return setup.create ?? { data: { user: { id: AUTH } }, error: null as Err };
  });
  const deleteUser = vi.fn(async (_id: string) => {
    calls.push("deleteUser");
    return { error: (setup.deleteError ?? null) as Err };
  });
  const inserted: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => ({
    select: (_cols: string) => ({
      eq: async (col: string, value: string) => {
        calls.push(`select ${table}.${col}`);
        if (table === "tenant")
          return setup.tenant ?? { data: [{ id: value }], error: null as Err };
        return setup.memberships ?? { data: [], error: null as Err };
      },
    }),
    insert: (row: Record<string, unknown>) => ({
      select: (_cols: string) => ({
        single: async () => {
          calls.push(`insert ${table}`);
          inserted.push(row);
          return setup.insert ?? { data: { id: MEMBER }, error: null as Err };
        },
      }),
    }),
  }));
  const rpc = vi.fn(async (fn: string, _args: Record<string, unknown>) => {
    calls.push(`rpc ${fn}`);
    if (setup.auditThrows) throw new Error(`fetch failed for ${EMAIL}`);
    return setup.audit ?? { data: 7, error: null as Err };
  });
  const admin = { from, rpc, auth: { admin: { listUsers, createUser, deleteUser } } };
  const make = vi.fn(() => admin as unknown as AddOwnerClient);
  const out: string[] = [];
  const err: string[] = [];
  return {
    calls,
    inserted,
    createUser,
    deleteUser,
    rpc,
    make,
    out,
    err,
    all: () => [...out, ...err].join("\n"),
    run: (argv: string[] = ARGS, env: Record<string, string | undefined> = {}) =>
      runAddOwner(argv, env, { admin: make, out: (l) => out.push(l), err: (l) => err.push(l) }),
  };
}

describe("add-owner: a new login", () => {
  it("creates a confirmed e-mail user with no password, inserts the owner row, then writes the audit row", async () => {
    const h = harness();
    expect(await h.run()).toBe(0);
    expect(h.createUser).toHaveBeenCalledWith({ email: EMAIL, email_confirm: true });
    expect(h.inserted).toEqual([
      { tenant_id: TENANT, auth_id: AUTH, role: "owner", display_name: "Titolare Demo" },
    ]);
    expect(h.rpc).toHaveBeenCalledWith("platform_record_script_run", {
      p_action: "script.add_owner",
      p_tenant: TENANT,
      p_detail: { tenantId: TENANT, appUserId: MEMBER, authId: AUTH, outcome: "created" },
    });
    expect(h.calls).toEqual([
      "select tenant.id",
      "listUsers",
      "createUser",
      "insert app_user",
      "rpc platform_record_script_run",
    ]);
  });

  it("prints only 8-character id prefixes, never a full id and never the address", async () => {
    const h = harness();
    await h.run();
    expect(h.out).toEqual([
      JSON.stringify({
        tenantId: "1111aaaa",
        authId: "a7000000",
        appUserId: "b7000000",
        created: true,
      }),
    ]);
    expect(h.all()).not.toContain("@");
    expect(h.all()).not.toContain(TENANT);
    expect(h.all()).not.toContain(AUTH);
  });

  it("removes the user it created when the owner row is refused", async () => {
    const h = harness({
      insert: { data: null, error: { message: "platform_staff_member_role", code: "P0001" } },
    });
    expect(await h.run()).toBe(1);
    expect(h.deleteUser).toHaveBeenCalledWith(AUTH);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.err.join("\n")).toContain("platform_staff_member_role");
    expect(h.err.join("\n")).toContain("auth user removed");
    expect(h.all()).not.toContain("@");
  });

  it("says when the created user could not be removed, by prefix only", async () => {
    const h = harness({
      insert: {
        data: null,
        error: { message: "duplicate key value violates unique constraint", code: "23505" },
      },
      deleteError: { message: `user ${EMAIL} not deleted`, code: "unexpected_failure" },
    });
    expect(await h.run()).toBe(1);
    const text = h.err.join("\n");
    expect(text).toContain("23505");
    expect(text).toContain("a7000000");
    expect(text).toContain("could NOT be removed (unexpected_failure)");
    expect(h.all()).not.toContain("@");
    expect(h.all()).not.toContain(AUTH);
  });

  it("fails with a code when the user cannot be created, and writes nothing", async () => {
    const h = harness({
      create: {
        data: { user: null },
        error: { message: `${EMAIL} is invalid`, code: "email_address_invalid" },
      },
    });
    expect(await h.run()).toBe(1);
    expect(h.err.join("\n")).toContain("email_address_invalid");
    expect(h.inserted).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.all()).not.toContain("@");
  });
});

describe("add-owner: an existing login", () => {
  it("reuses a login that is a member nowhere (address compared ignoring case) and creates no user", async () => {
    const h = harness({
      users: [
        { id: "a7000000-0000-4000-8000-0000000000ff", email: "other@example.test" },
        { id: AUTH, email: "New.Owner@Example.test" },
      ],
    });
    expect(await h.run()).toBe(0);
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.inserted[0]).toMatchObject({ auth_id: AUTH, role: "owner" });
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_detail: { outcome: "reused" } });
    expect(h.out[0]).toContain('"created":false');
  });

  it("refuses a login that is a member of any tenant, before any write", async () => {
    const h = harness({
      users: [{ id: AUTH, email: EMAIL }],
      memberships: { data: [{ tenant_id: "22222222-2222-4222-8222-222222222222" }], error: null },
    });
    expect(await h.run()).toBe(1);
    expect(h.err.join("\n")).toContain("auth_user_is_member");
    expect(h.inserted).toEqual([]);
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.all()).not.toContain("@");
  });

  it("never removes a reused login when the owner row is refused", async () => {
    const h = harness({
      users: [{ id: AUTH, email: EMAIL }],
      insert: { data: null, error: { message: "platform_staff_member_role", code: "P0001" } },
    });
    expect(await h.run()).toBe(1);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.err.join("\n")).toContain("no auth user was touched");
  });

  it("fails with a code when the membership read fails", async () => {
    const h = harness({
      users: [{ id: AUTH, email: EMAIL }],
      memberships: { data: null, error: { message: "read failed", code: "PGRST000" } },
    });
    expect(await h.run()).toBe(1);
    expect(h.err.join("\n")).toContain("PGRST000");
    expect(h.inserted).toEqual([]);
  });

  it("fails with a code when the user list cannot be read", async () => {
    const h = harness({
      listError: { message: `list failed for ${EMAIL}`, code: "unexpected_failure" },
    });
    expect(await h.run()).toBe(1);
    expect(h.err.join("\n")).toContain("unexpected_failure");
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.all()).not.toContain("@");
  });
});

describe("add-owner: the tenant and the audit row", () => {
  it("refuses a tenant that does not exist before touching Auth", async () => {
    const h = harness({ tenant: { data: [], error: null } });
    expect(await h.run()).toBe(1);
    expect(h.err.join("\n")).toContain("tenant_not_found");
    expect(h.calls).toEqual(["select tenant.id"]);
  });

  it("fails with a code when the tenant read fails", async () => {
    const h = harness({
      tenant: { data: null, error: { message: "read failed", code: "PGRST000" } },
    });
    expect(await h.run()).toBe(1);
    expect(h.err.join("\n")).toContain("PGRST000");
    expect(h.calls).toEqual(["select tenant.id"]);
  });

  it.each([
    [
      "an error answer",
      { audit: { data: null, error: { message: "invalid_script_action", code: "22023" } } },
      "invalid_script_action",
    ],
    ["a thrown call", { auditThrows: true }, "unreachable"],
  ] as const)(
    "on %s the run fails and says the owner WAS added, by prefix only",
    async (_label, setup, code) => {
      const h = harness(setup as Setup);
      expect(await h.run()).toBe(1);
      const text = h.err.join("\n");
      expect(text).toContain("audit not written");
      expect(text).toContain(code);
      expect(text).toContain("the owner WAS added");
      expect(text).toContain("b7000000");
      expect(h.deleteUser).not.toHaveBeenCalled();
      expect(h.all()).not.toContain("@");
      expect(h.all()).not.toContain(MEMBER);
    },
  );

  it("refuses an unexpected insert answer after the row may exist, without removing anything", async () => {
    const h = harness({ insert: { data: { id: "not-a-uuid" }, error: null } });
    expect(await h.run()).toBe(1);
    expect(h.err.join("\n")).toContain("unexpected_answer");
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("add-owner: arguments", () => {
  it.each([
    [[]],
    [["--tenant", TENANT, "--email", EMAIL]],
    [["--tenant", TENANT.toUpperCase(), "--email", EMAIL, "--name", "Titolare Demo"]],
    [["--tenant", "not-a-uuid", "--email", EMAIL, "--name", "Titolare Demo"]],
    [["--tenant", TENANT, "--email", "not-an-address", "--name", "Titolare Demo"]],
    [["--tenant", TENANT, "--email", EMAIL, "--name", "   "]],
    [["--tenant", TENANT, "--email", EMAIL, "--name", "x".repeat(101)]],
    [[...ARGS, "--extra", "1"]],
    [[...ARGS, "positional"]],
    [["--tenant", TENANT, "--tenant", TENANT, "--email", EMAIL, "--name", "Titolare Demo"]],
  ])("refuses %j with exit 2, calls nothing and echoes nothing", async (argv) => {
    const h = harness();
    expect(await h.run(argv as string[])).toBe(2);
    expect(h.make).not.toHaveBeenCalled();
    expect(h.all()).not.toContain("@");
    expect(h.all()).not.toContain("not-an-address");
    expect(h.all()).not.toContain(TENANT.toUpperCase());
  });
});
