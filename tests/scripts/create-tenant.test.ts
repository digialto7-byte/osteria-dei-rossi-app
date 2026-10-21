import { describe, expect, it, vi } from "vitest";
import { createTenant, parseCreateTenantArgs } from "../../scripts/lib/create-tenant";

const ARGS = [
  "--name",
  "Osteria Demo",
  "--vat",
  "IT00000000000",
  "--owner-email",
  "owner@example.test",
  "--owner-name",
  "Titolare Demo",
];

function fakeAdmin(
  options: { rpcError?: { message: string }; createError?: { message: string } } = {},
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

describe("parseCreateTenantArgs", () => {
  it("reads the four named arguments", () => {
    expect(parseCreateTenantArgs(ARGS)).toEqual({
      name: "Osteria Demo",
      vatNumber: "IT00000000000",
      ownerEmail: "owner@example.test",
      ownerName: "Titolare Demo",
    });
  });

  it("rejects a VAT number that is not IT + 11 digits, naming the argument", () => {
    const args = [...ARGS];
    args[3] = "IT123";
    expect(() => parseCreateTenantArgs(args)).toThrow(/--vat/);
  });

  it("rejects a missing argument, naming it", () => {
    expect(() => parseCreateTenantArgs(ARGS.slice(0, 6))).toThrow(/--owner-name/);
  });

  it("rejects an unknown argument", () => {
    expect(() => parseCreateTenantArgs([...ARGS, "--role", "admin"])).toThrow(/--role/);
  });
});

describe("createTenant", () => {
  const input = parseCreateTenantArgs(ARGS);

  it("creates a confirmed auth user, then the tenant and owner in one RPC", async () => {
    const admin = fakeAdmin();
    await expect(createTenant(admin, input)).resolves.toBe("11111111-1111-4111-8111-111111111111");
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: "owner@example.test",
      email_confirm: true,
    });
    expect(admin.rpc).toHaveBeenCalledWith("create_tenant_with_owner", {
      tenant_name: "Osteria Demo",
      tenant_vat_number: "IT00000000000",
      owner_auth_id: "a0000000-0000-4000-8000-00000000000a",
      owner_display_name: "Titolare Demo",
    });
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes the auth user it created when the tenant cannot be created", async () => {
    const admin = fakeAdmin({ rpcError: { message: "duplicate key value" } });
    await expect(createTenant(admin, input)).rejects.toThrow(/tenant/i);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(
      "a0000000-0000-4000-8000-00000000000a",
    );
  });

  it("stops before touching the database when the auth user cannot be created", async () => {
    const admin = fakeAdmin({ createError: { message: "already registered" } });
    await expect(createTenant(admin, input)).rejects.toThrow(/auth user/i);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
