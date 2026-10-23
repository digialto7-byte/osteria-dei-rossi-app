import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { STAFF_EMAIL_DOMAIN } from "./constants";
import { StaffAuthCallError } from "./errors";
import type { DeviceStaffListResult, PinBeginResult, PinFinishResult, RedeemResult } from "./types";

// ADR-010 decision D1-A (founder, 2026-10-23): the ONE module outside cron and scripts that holds
// the Supabase secret-key client. Rules, each pinned by tests/server/staff-auth/privileged.test.ts:
//  - exactly seven exported functions; the client and the key are never exported or returned;
//  - every function validates its input before any call, then makes one RPC or one admin call
//    (deleteOrphanStaffAuthUser reads the user first, to refuse anything that is not a staff account);
//  - nothing here logs, and errors carry the SQLSTATE or Auth status and code only, never a value.

const HEX_64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A derived PIN password (derive.ts): base64url of a 32-byte HMAC. Anything else is not one.
const DERIVED_PASSWORD = /^[A-Za-z0-9_-]{43}$/;
const OUTCOMES = ["success", "failure", "error"] as const;

type Outcome = (typeof OUTCOMES)[number];

function invalid(operation: string): never {
  throw new StaffAuthCallError(operation, "invalid_argument");
}

function check(operation: string, ok: boolean): void {
  if (!ok) invalid(operation);
}

const isHex = (value: unknown): value is string => typeof value === "string" && HEX_64.test(value);
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isPassword = (value: unknown): value is string =>
  typeof value === "string" && DERIVED_PASSWORD.test(value);

async function callRpc<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: { code?: string } | null };
  try {
    result = await createSupabaseAdminClient().rpc(operation, args);
  } catch {
    throw new StaffAuthCallError(operation, "request_failed");
  }
  if (result.error) throw new StaffAuthCallError(operation, result.error.code);
  return result.data as T;
}

function authFailure(operation: string, error: { code?: string; status?: number }) {
  return new StaffAuthCallError(operation, error.code, error.status);
}

/** Never calls an Auth method with a rejection's text: only the fact is kept. */
async function authCall<T extends { error: { code?: string; status?: number } | null }>(
  operation: string,
  call: () => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch {
    throw new StaffAuthCallError(operation, "request_failed");
  }
  return result;
}

/** pin_login_begin: device and user gates, and the pending attempt, before Supabase Auth is called. */
export async function beginPinLogin(tokenHash: string, userId: string): Promise<PinBeginResult> {
  check("pin_login_begin", isHex(tokenHash) && isUuid(userId));
  return callRpc<PinBeginResult>("pin_login_begin", { p_token_hash: tokenHash, p_user: userId });
}

/** pin_login_finish: records the outcome of the Auth call and applies the lockouts. */
export async function finishPinLogin(
  attemptId: string,
  outcome: Outcome,
  authSessionId: string | null,
): Promise<PinFinishResult> {
  check("pin_login_finish", isUuid(attemptId));
  check("pin_login_finish", (OUTCOMES as readonly unknown[]).includes(outcome));
  // A session id goes with a success, and only with a success.
  check("pin_login_finish", outcome === "success" ? isUuid(authSessionId) : authSessionId === null);
  return callRpc<PinFinishResult>("pin_login_finish", {
    p_attempt: attemptId,
    p_outcome: outcome,
    p_auth_session: authSessionId,
  });
}

/** redeem_enrolment_code: one transaction that checks the IP limit and the code, and enrols the device. */
export async function redeemEnrolmentCode(
  codeHash: string,
  tokenHash: string,
  ipHash: string,
): Promise<RedeemResult> {
  check("redeem_enrolment_code", isHex(codeHash) && isHex(tokenHash) && isHex(ipHash));
  return callRpc<RedeemResult>("redeem_enrolment_code", {
    p_code_hash: codeHash,
    p_token_hash: tokenHash,
    p_ip_hash: ipHash,
  });
}

/** device_staff_list: the people shown on an enrolled device's login screen. */
export async function deviceStaffList(tokenHash: string): Promise<DeviceStaffListResult> {
  check("device_staff_list", isHex(tokenHash));
  return callRpc<DeviceStaffListResult>("device_staff_list", { p_token_hash: tokenHash });
}

/** Creates the Supabase Auth user of a PIN account: a synthetic, confirmed, never-mailed address. */
export async function createStaffAuthUser(
  appUserId: string,
  derivedPassword: string,
): Promise<{ authId: string }> {
  check("create_staff_auth_user", isUuid(appUserId) && isPassword(derivedPassword));
  const { data, error } = await authCall("create_staff_auth_user", () =>
    createSupabaseAdminClient().auth.admin.createUser({
      email: `staff-${appUserId}@${STAFF_EMAIL_DOMAIN}`,
      password: derivedPassword,
      email_confirm: true,
    }),
  );
  if (error) throw authFailure("create_staff_auth_user", error);
  const authId = data.user?.id;
  if (!authId) throw new StaffAuthCallError("create_staff_auth_user", "no_user");
  return { authId };
}

/** Sets the derived password of an existing PIN account (PIN set or reset). */
export async function setStaffAuthPassword(authId: string, derivedPassword: string): Promise<void> {
  check("set_staff_auth_password", isUuid(authId) && isPassword(derivedPassword));
  const { error } = await authCall("set_staff_auth_password", () =>
    createSupabaseAdminClient().auth.admin.updateUserById(authId, { password: derivedPassword }),
  );
  if (error) throw authFailure("set_staff_auth_password", error);
}

/**
 * Removes the Auth user left behind when create_staff failed. It deletes only a synthetic staff address;
 * app_user.auth_id references auth.users, so Postgres itself refuses to delete a linked account.
 * Returns whether a user was deleted.
 */
export async function deleteOrphanStaffAuthUser(authId: string): Promise<boolean> {
  check("delete_orphan_staff_auth_user", isUuid(authId));
  const lookup = await authCall("delete_orphan_staff_auth_user", () =>
    createSupabaseAdminClient().auth.admin.getUserById(authId),
  );
  if (lookup.error) {
    if (lookup.error.status === 404) return false;
    throw authFailure("delete_orphan_staff_auth_user", lookup.error);
  }
  const email = lookup.data.user?.email;
  if (!email || !email.startsWith("staff-") || !email.endsWith(`@${STAFF_EMAIL_DOMAIN}`)) {
    return false;
  }
  const { error } = await authCall("delete_orphan_staff_auth_user", () =>
    createSupabaseAdminClient().auth.admin.deleteUser(authId),
  );
  if (error) throw authFailure("delete_orphan_staff_auth_user", error);
  return true;
}
