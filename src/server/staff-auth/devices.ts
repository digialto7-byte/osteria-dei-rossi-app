import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStaffAuthDbError } from "./errors";
import { callAsUser } from "./rpc";
import { displayCode, generateEnrolmentCode, sha256Hex } from "./tokens";
import type { DeviceOverview, DeviceView } from "./types";

interface CodeRow {
  id: string;
  label: string;
  expiresAt: string;
}

// Answers are built field by field: whatever else a procedure returns never reaches the owner. In
// particular there is no per-person login or logout time (project Q10); a device shows its own last use.
function pickDevice(row: DeviceView): DeviceView {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    enrolledAt: row.enrolledAt,
    lastLoginAt: row.lastLoginAt ?? null,
    lockedAt: row.lockedAt ?? null,
  };
}

export async function listDevices(supabase: SupabaseClient): Promise<DeviceOverview> {
  const overview = await callAsUser<DeviceOverview>(supabase, "device_overview");
  return {
    devices: (overview.devices ?? []).map(pickDevice),
    pendingCodes: (overview.pendingCodes ?? []).map(({ id, label, expiresAt }) => ({
      id,
      label,
      expiresAt,
    })),
  };
}

/** The plain code is generated here, shown once, and only its SHA-256 reaches the database. */
export async function createEnrolmentCode(supabase: SupabaseClient, label: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const code = generateEnrolmentCode();
    const { data, error } = await supabase.rpc("create_enrolment_code", {
      p_code_hash: sha256Hex(code),
      p_label: label,
    });
    if (error?.code === "23505" && attempt === 0) continue; // a hash collision: one retry
    if (error) throw mapStaffAuthDbError(error);
    const row = data as CodeRow;
    return { code, display: displayCode(code), label: row.label, expiresAt: row.expiresAt };
  }
  /* c8 ignore next */
  throw new Error("Unreachable");
}

export async function revokeDevice(supabase: SupabaseClient, id: string) {
  return pickDevice(await callAsUser<DeviceView>(supabase, "revoke_device", { p_device: id }));
}

export async function unlockDevice(supabase: SupabaseClient, id: string) {
  return pickDevice(await callAsUser<DeviceView>(supabase, "unlock_device", { p_device: id }));
}
