"use client";

import { forgetUser } from "@/components/forget-user";
import type { MfaSlot } from "@/lib/auth/mfa-constants";
import { safeNextPath } from "@/lib/api/safe-next";
import { EnrolFactor } from "./enrol-factor";

/**
 * The enrolment component on a sign-in page: when the person is done the way back (`next`, made safe again here) is followed.
 * The session is now at aal2, so the cached user is forgotten and the next screen is a new document (T-12).
 */
export function EnrolToNext({
  next,
  slot = "principale",
  offerBackup = true,
  onCancel,
}: {
  next: string | undefined;
  slot?: MfaSlot;
  offerBackup?: boolean;
  onCancel?: () => void;
}) {
  return (
    <EnrolFactor
      slot={slot}
      offerBackup={offerBackup}
      onCancel={onCancel}
      onFinished={() => {
        forgetUser();
        // A full load: this page's CSP allows data: images, and a client navigation would carry that on to the next screen.
        window.location.assign(safeNextPath(next));
      }}
    />
  );
}
