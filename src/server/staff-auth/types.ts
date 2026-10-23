/** Shapes of what the M11 procedures return (migrations 20261025100200 to 20261025100800). */

export type StaffRole = "chef" | "waiter";

/** public.pin_login_begin. `proceed` is the only status after which Supabase Auth may be called. */
export type PinBeginResult =
  | { status: "proceed"; attemptId: string; authEmail: string }
  | { status: "device_unknown" | "device_revoked" | "device_locked" | "attempt_in_progress" }
  | { status: "pin_invalid"; attemptsLeft?: number }
  | { status: "user_locked"; lockedUntil: string };

/** public.pin_login_finish. */
export type PinFinishResult =
  | { status: "ok"; endsAt: string }
  | { status: "pin_invalid"; attemptsLeft: number }
  | { status: "user_locked"; lockedUntil: string }
  | { status: "device_locked" | "device_revoked" | "auth_error" };

/** public.redeem_enrolment_code. */
export type RedeemResult =
  | { status: "ok"; deviceId: string; label: string }
  | { status: "code_invalid" | "code_used" | "code_expired" | "rate_limited" };

/** public.device_staff_list. */
export type DeviceStaffListResult =
  | { status: "unknown" | "revoked" }
  | {
      status: "ok";
      label: string;
      locked: boolean;
      staff: { id: string; displayName: string; role: StaffRole }[];
    };

/** Rows of public.staff_list: deliberately no login time of any person (project Q10). */
export interface StaffListRow {
  id: string;
  display_name: string;
  role: StaffRole;
  login_method: "email" | "pin";
  is_active: boolean;
  locked_until: string | null;
}

export type DeviceStatus = "attivo" | "bloccato" | "revocato";

export interface DeviceView {
  id: string;
  label: string;
  status: DeviceStatus;
  enrolledAt: string;
  lastLoginAt: string | null;
  lockedAt: string | null;
}

/** public.device_overview. */
export interface DeviceOverview {
  devices: DeviceView[];
  pendingCodes: { id: string; label: string; expiresAt: string }[];
}
