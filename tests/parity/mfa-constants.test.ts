import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MFA_LOCK_FAILURES,
  MFA_LOCK_MINUTES,
  MFA_MAX_FACTORS,
  MFA_SLOT_NAMES,
  MFA_SLOTS,
  slotOfFriendlyName,
} from "@/lib/auth/mfa-constants";

// P2-1 A10: the TypeScript constants of the second factor equal their SQL twins, read from the migration text (the same technique as the other parity tests).
const read = (file: string) =>
  readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
const SELF = read("20261201100100_mfa_self.sql");
const ADMIN = read("20261201100200_mfa_admin.sql");
const sqlConstant = (sql: string, name: string) =>
  Number(
    new RegExp(`function app\\.${name}\\(\\) returns integer[^$]*\\$\\$ select (\\d+) \\$\\$`).exec(
      sql,
    )?.[1],
  );

describe("second-factor constants: TypeScript and SQL", () => {
  it("the lock is 5 wrong codes in 15 minutes", () => {
    expect(sqlConstant(SELF, "mfa_lock_failures")).toBe(5);
    expect(sqlConstant(SELF, "mfa_lock_minutes")).toBe(15);
    expect(MFA_LOCK_FAILURES).toBe(sqlConstant(SELF, "mfa_lock_failures"));
    expect(MFA_LOCK_MINUTES).toBe(sqlConstant(SELF, "mfa_lock_minutes"));
  });

  it("an account holds at most two verified factors", () => {
    expect(MFA_MAX_FACTORS).toBe(sqlConstant(SELF, "mfa_max_factors"));
    expect(MFA_MAX_FACTORS).toBe(2);
  });

  it("the slots and their friendly names are the ones public.mfa_enrol_check knows", () => {
    expect(MFA_SLOTS).toEqual(["principale", "riserva"]);
    for (const slot of MFA_SLOTS) {
      expect(SELF).toContain(`when '${slot}' then '${MFA_SLOT_NAMES[slot]}'`);
    }
  });

  it("a name set outside the app is the slot altro, as in public.mfa_record_enrolled", () => {
    expect(slotOfFriendlyName("Principale")).toBe("principale");
    expect(slotOfFriendlyName("Riserva")).toBe("riserva");
    expect(slotOfFriendlyName("Il mio telefono")).toBe("altro");
    expect(slotOfFriendlyName(null)).toBe("altro");
    expect(SELF).toContain("else 'altro' end");
  });

  it("the break-glass reset stays pending for 5 minutes (the script waits no longer than that)", () => {
    expect(sqlConstant(ADMIN, "mfa_reset_pending_minutes")).toBe(5);
  });
});
