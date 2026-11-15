import { describe, expect, it, vi } from "vitest";
import {
  assertNoArguments,
  createIdDisplay,
  createTenant,
  readCreateTenantEnv,
} from "../../scripts/lib/create-tenant";

// SP3 (review of step 6): the tenant and owner data arrive as environment variables (the platform-ops secrets), never as arguments. Under GitHub Actions an id
// is masked before anything of it is printed and only its first 8 characters are shown; errors are codes only, never a raw Supabase message.
const ENV = {
  TENANT_NAME: "Osteria Demo",
  TENANT_VAT_NUMBER: "IT00000000000",
  OWNER_EMAIL: "owner@example.test",
  OWNER_NAME: "Titolare Demo",
};
const TENANT = "11111111-1111-4111-8111-111111111111";
const OWNER = "a0000000-0000-4000-8000-00000000000a";

function fakeAdmin(
  options: {
    rpcError?: { message: string; code?: string };
    createError?: { message: string; code?: string };
  } = {},
) {
  return {
    auth: {
      admin: {
        createUser: vi
          .fn()
          .mockResolvedValue(
            options.createError
              ? { data: { user: null }, error: options.createError }
              : { data: { user: { id: "a0000000-0000-4000-8000-00000000000a" } }, error: null },
          ),
        deleteUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
    rpc: vi
      .fn()
      .mockResolvedValue(
        options.rpcError
          ? { data: null, error: options.rpcError }
          : { data: "11111111-1111-4111-8111-111111111111", error: null },
      ),
  };
}

describe("readCreateTenantEnv", () => {
  it("reads the four variables", () => {
    expect(readCreateTenantEnv(ENV)).toEqual({
      name: "Osteria Demo",
      vatNumber: "IT00000000000",
      ownerEmail: "owner@example.test",
      ownerName: "Titolare Demo",
    });
  });

  it("fails before any call when variables are missing or empty, naming them and never a value", () => {
    const { TENANT_NAME: _n, ...rest } = ENV;
    const run = () => readCreateTenantEnv({ ...rest, OWNER_EMAIL: "" });
    expect(run).toThrow(/TENANT_NAME/);
    expect(run).toThrow(/OWNER_EMAIL/);
    try {
      run();
    } catch (error) {
      const text = String(error instanceof Error ? error.message : error);
      for (const value of Object.values(ENV)) expect(text).not.toContain(value);
      expect(text).not.toContain("TENANT_VAT_NUMBER");
      expect(text).not.toContain("OWNER_NAME");
    }
  });

  it("treats a blank (spaces only) variable as missing", () => {
    expect(() => readCreateTenantEnv({ ...ENV, OWNER_NAME: "   " })).toThrow(/OWNER_NAME/);
  });

  it("rejects a VAT number that is not IT + 11 digits, naming the variable and not the value", () => {
    const bad = { ...ENV, TENANT_VAT_NUMBER: "IT123" };
    expect(() => readCreateTenantEnv(bad)).toThrow(/TENANT_VAT_NUMBER/);
    expect(() => readCreateTenantEnv(bad)).not.toThrow(/IT123/);
  });

  it("rejects an invalid owner address without printing it", () => {
    const bad = { ...ENV, OWNER_EMAIL: "not-an-address" };
    expect(() => readCreateTenantEnv(bad)).toThrow(/OWNER_EMAIL/);
    expect(() => readCreateTenantEnv(bad)).not.toThrow(/not-an-address/);
  });
});

describe("assertNoArguments", () => {
  it("accepts none and refuses any, without echoing it", () => {
    expect(() => assertNoArguments([])).not.toThrow();
    expect(() => assertNoArguments(["--name", "Osteria Demo"])).toThrow(/TENANT_NAME/);
    expect(() => assertNoArguments(["--name", "Osteria Demo"])).not.toThrow(/Osteria Demo/);
  });
});

describe("createIdDisplay", () => {
  it("locally shows the full id and prints nothing else", () => {
    const written: string[] = [];
    const display = createIdDisplay({}, (line) => written.push(line));
    expect(display.reveal(TENANT)).toBe(TENANT);
    expect(written).toEqual([]);
  });

  it("under GITHUB_ACTIONS=true masks the id first, then shows the 8-character prefix only", () => {
    const written: string[] = [];
    const display = createIdDisplay({ GITHUB_ACTIONS: "true" }, (line) => written.push(line));
    expect(display.reveal(TENANT)).toBe("11111111");
    expect(written).toEqual([`::add-mask::${TENANT}`]);
  });

  it("GITHUB_ACTIONS=false is local", () => {
    expect(createIdDisplay({ GITHUB_ACTIONS: "false" }, () => undefined).reveal(TENANT)).toBe(
      TENANT,
    );
  });

  it("CREATE_TENANT_FULL_ID=1 (the backup self-test's throwaway stack) shows the full id even in CI", () => {
    const written: string[] = [];
    const env = { GITHUB_ACTIONS: "true", CREATE_TENANT_FULL_ID: "1" };
    expect(createIdDisplay(env, (line) => written.push(line)).reveal(TENANT)).toBe(TENANT);
    expect(written).toEqual([]);
  });
});

describe("createTenant", () => {
  const input = readCreateTenantEnv(ENV);
  const full = createIdDisplay({}, () => undefined);

  it("creates a confirmed auth user, then the tenant and owner in one RPC", async () => {
    const admin = fakeAdmin();
    await expect(createTenant(admin, input, full)).resolves.toBe(TENANT);
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: "owner@example.test",
      email_confirm: true,
    });
    expect(admin.rpc).toHaveBeenCalledWith("create_tenant_with_owner", {
      tenant_name: "Osteria Demo",
      tenant_vat_number: "IT00000000000",
      owner_auth_id: OWNER,
      owner_display_name: "Titolare Demo",
    });
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes the auth user it created when the tenant cannot be created, and reports a code only", async () => {
    const admin = fakeAdmin({ rpcError: { message: "duplicate key value", code: "23505" } });
    const error = await createTenant(admin, input, full).catch((e: unknown) => e);
    expect(String((error as Error).message)).toMatch(/tenant/i);
    expect((error as Error).message).toContain("23505");
    expect((error as Error).message).not.toContain("duplicate key value");
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(OWNER);
  });

  it("a fixed error name of ours is shown as it is; anything else only as its code", async () => {
    const admin = fakeAdmin({ rpcError: { message: "vat_number_taken", code: "P0001" } });
    await expect(createTenant(admin, input, full)).rejects.toThrow(/vat_number_taken/);
    const raw = fakeAdmin({ rpcError: { message: "boom owner@example.test" } });
    const error = await createTenant(raw, input, full).catch((e: unknown) => e);
    expect((error as Error).message).toContain("unknown_error");
    expect((error as Error).message).not.toContain("owner@example.test");
  });

  it("says so when removing the auth user fails too, naming the id to delete by hand (full locally)", async () => {
    const admin = fakeAdmin({ rpcError: { message: "duplicate key value", code: "23505" } });
    admin.auth.admin.deleteUser.mockResolvedValue({
      data: null,
      error: { message: "network down", code: "x" },
    });
    const error = await createTenant(admin, input, full).catch((e: unknown) => e);
    expect((error as Error).message).toContain(`${OWNER} could NOT be removed`);
    expect((error as Error).message).not.toContain("network down");
  });

  it("under CI the id in that message is the 8-character prefix, and the id was masked first", async () => {
    const written: string[] = [];
    const ci = createIdDisplay({ GITHUB_ACTIONS: "true" }, (line) => written.push(line));
    const admin = fakeAdmin({ rpcError: { message: "x", code: "23505" } });
    admin.auth.admin.deleteUser.mockResolvedValue({
      data: null,
      error: { message: "n", code: "x" },
    });
    const error = await createTenant(admin, input, ci).catch((e: unknown) => e);
    expect(written).toEqual([`::add-mask::${OWNER}`]);
    expect((error as Error).message).toContain("a0000000 could NOT be removed");
    expect((error as Error).message).not.toContain(OWNER);
  });

  it("stops before touching the database when the auth user cannot be created, with a code only", async () => {
    const admin = fakeAdmin({
      createError: { message: "already registered owner@example.test", code: "email_exists" },
    });
    const error = await createTenant(admin, input, full).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/auth user/i);
    expect((error as Error).message).toContain("email_exists");
    expect((error as Error).message).not.toContain("owner@example.test");
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
