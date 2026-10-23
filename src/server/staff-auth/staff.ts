import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { derivePinPassword } from "./derive";
import { pinTrivialError } from "./errors";
import { checkPin } from "./pin-policy";
import { createStaffAuthUser, deleteOrphanStaffAuthUser, setStaffAuthPassword } from "./privileged";
import { callAsUser, viaAuthAdmin } from "./rpc";
import type { CreateUserBody, PatchUserBody } from "./schemas";
import type { StaffListRow, StaffRole } from "./types";

export interface StaffUser {
  id: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
}

const pickUser = (row: StaffUser): StaffUser => ({
  id: row.id,
  displayName: row.displayName,
  role: row.role,
  active: row.active,
});

/** A trivial PIN is refused before anything else is called (the body schema already checked the format). */
function assertPinAllowed(pin: string): void {
  if (checkPin(pin) === "trivial") throw pinTrivialError();
}

export async function listStaff(supabase: SupabaseClient) {
  const rows = await callAsUser<StaffListRow[] | null>(supabase, "staff_list");
  return (rows ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    loginMethod: row.login_method,
    active: row.is_active,
    lockedUntil: row.locked_until,
  }));
}

/**
 * Creates a PIN account. Order matters (plan §3.1.8): policy, the owner-session role check, the Auth
 * user, then the app row; if the app row fails the Auth user is removed again.
 */
export async function createStaff(supabase: SupabaseClient, body: CreateUserBody, pepper: string) {
  assertPinAllowed(body.pin);
  await callAsUser(supabase, "assert_staff_manager");
  const id = randomUUID();
  const { authId } = await viaAuthAdmin(() =>
    createStaffAuthUser(id, derivePinPassword(pepper, id, body.pin)),
  );
  try {
    const created = await callAsUser<StaffUser>(supabase, "create_staff", {
      p_id: id,
      p_auth_id: authId,
      p_display_name: body.displayName,
      p_role: body.role,
    });
    return pickUser(created);
  } catch (error) {
    try {
      await deleteOrphanStaffAuthUser(authId);
    } catch {
      // The original error is the useful one; an orphan Auth user is harmless (never mailed, no app row).
    }
    throw error;
  }
}

export async function updateStaff(supabase: SupabaseClient, id: string, body: PatchUserBody) {
  const updated = await callAsUser<StaffUser>(supabase, "update_staff", {
    p_user: id,
    p_display_name: body.displayName ?? null,
    p_role: body.role ?? null,
    p_active: body.active ?? null,
  });
  return pickUser(updated);
}

/** Sets or resets a PIN: prepare (owner session) -> new password at Auth -> record (owner session). */
export async function setStaffPin(
  supabase: SupabaseClient,
  id: string,
  pin: string,
  pepper: string,
): Promise<void> {
  assertPinAllowed(pin);
  const { authId } = await callAsUser<{ authId: string }>(supabase, "prepare_pin_change", {
    p_user: id,
  });
  await viaAuthAdmin(() => setStaffAuthPassword(authId, derivePinPassword(pepper, id, pin)));
  await callAsUser(supabase, "record_pin_change", { p_user: id });
}
