import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { AUTH_CALL_TIMEOUT_MS } from "./constants";
import { derivePinPassword } from "./derive";
import { mapStaffAuthStatus } from "./errors";
import { beginPinLogin, finishPinLogin } from "./privileged";
import { sha256Hex } from "./tokens";
import type { PinFinishResult } from "./types";

// PIN login in two phases around Supabase Auth (ADR-010 decision 4). Postgres decides whether Auth may be
// called at all (begin) and records what happened (finish). Nothing here logs: the PIN and the derived
// password live in this function's memory only.

export interface PinLoginInput {
  /** The signed-in-as-nobody server client; signInWithPassword puts the session cookies on it. */
  supabase: SupabaseClient;
  /** The raw device cookie value, or null when the cookie is absent or malformed. */
  deviceToken: string | null;
  userId: string;
  pin: string;
  pepper: string;
}

export interface PinLoginResult {
  user: { id: string; displayName: string; role: "chef" | "waiter" };
  endsAt: string;
}

const TIMED_OUT = Symbol("timed out");

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const tokenClaims = z.object({ session_id: z.uuid(), sub: z.uuid() });

/** The Auth session id and user id of a fresh access token. It just came from Auth over TLS: only read. */
export function claimsOf(
  accessToken: string | undefined,
): { sessionId: string; sub: string } | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) return null;
  try {
    const parsed = tokenClaims.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.success ? { sessionId: parsed.data.session_id, sub: parsed.data.sub } : null;
  } catch {
    return null;
  }
}

type AuthAttempt =
  | { kind: "success"; sessionId: string; authId: string }
  | { kind: "wrong_pin" }
  | { kind: "rate_limited" }
  | { kind: "upstream" };

async function attemptSignIn(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<AuthAttempt> {
  let result;
  try {
    result = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      AUTH_CALL_TIMEOUT_MS,
    );
  } catch {
    return { kind: "upstream" };
  }
  if (result === TIMED_OUT) return { kind: "upstream" };
  const { data, error } = result;
  if (error) {
    if (error.code === "invalid_credentials") return { kind: "wrong_pin" };
    if (error.status === 429) return { kind: "rate_limited" };
    return { kind: "upstream" };
  }
  const claims = claimsOf(data?.session?.access_token);
  return claims
    ? { kind: "success", sessionId: claims.sessionId, authId: claims.sub }
    : { kind: "upstream" };
}

async function signOutQuietly(supabase: SupabaseClient): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The session is closed on the server side by the error answer; there is nothing else to do.
  }
}

const upstream = () => mapStaffAuthStatus("upstream_error");

/** Maps what pin_login_finish answered when the person is not logged in. */
function refusalFor(finish: PinFinishResult): ApiError {
  switch (finish.status) {
    case "pin_invalid":
      return mapStaffAuthStatus("pin_invalid", { attemptsLeft: finish.attemptsLeft });
    case "user_locked":
      return mapStaffAuthStatus("user_locked", { lockedUntil: finish.lockedUntil });
    case "device_locked":
      return mapStaffAuthStatus("device_locked");
    case "device_revoked":
      return mapStaffAuthStatus("device_revoked");
    default:
      return upstream();
  }
}

async function readProfile(supabase: SupabaseClient, authId: string) {
  const { data, error } = await supabase
    .from("app_user")
    .select("id, display_name, role")
    .eq("auth_id", authId)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = z
    .object({ id: z.uuid(), display_name: z.string(), role: z.enum(["chef", "waiter"]) })
    .safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function pinLogin(input: PinLoginInput): Promise<PinLoginResult> {
  const { supabase, deviceToken, userId, pin, pepper } = input;

  // 1. No device, no call of any kind.
  if (!deviceToken) throw mapStaffAuthStatus("device_missing");

  // 2. Postgres gate: device, user locks, one attempt in flight.
  const begin = await beginPinLogin(sha256Hex(deviceToken), userId);
  switch (begin.status) {
    case "proceed":
      break;
    case "pin_invalid":
      throw mapStaffAuthStatus("pin_invalid", { attemptsLeft: begin.attemptsLeft });
    case "user_locked":
      throw mapStaffAuthStatus("user_locked", { lockedUntil: begin.lockedUntil });
    case "device_unknown":
    case "device_revoked":
    case "device_locked":
    case "attempt_in_progress":
      throw mapStaffAuthStatus(begin.status);
    default:
      throw upstream();
  }

  // 3. Supabase Auth, with the derived password.
  const attempt = await attemptSignIn(
    supabase,
    begin.authEmail,
    derivePinPassword(pepper, userId, pin),
  );

  // 4. Record the outcome. A failure here after a good sign-in must not leave a session behind.
  const outcome =
    attempt.kind === "success" ? "success" : attempt.kind === "wrong_pin" ? "failure" : "error";
  let finish: PinFinishResult;
  try {
    finish = await finishPinLogin(
      begin.attemptId,
      outcome,
      attempt.kind === "success" ? attempt.sessionId : null,
    );
  } catch {
    if (attempt.kind === "success") await signOutQuietly(supabase);
    throw upstream();
  }

  if (attempt.kind === "rate_limited") throw mapStaffAuthStatus("auth_rate_limited");
  if (attempt.kind === "upstream") {
    await signOutQuietly(supabase);
    throw upstream();
  }
  if (attempt.kind === "wrong_pin") throw refusalFor(finish);

  if (finish.status !== "ok") {
    await signOutQuietly(supabase);
    throw refusalFor(finish);
  }

  // 5. The new session reads its own profile (RLS), so the screen can greet the person.
  const profile = await readProfile(supabase, attempt.authId);
  if (!profile) {
    await signOutQuietly(supabase);
    throw upstream();
  }
  return {
    user: { id: profile.id, displayName: profile.display_name, role: profile.role },
    endsAt: finish.endsAt,
  };
}
