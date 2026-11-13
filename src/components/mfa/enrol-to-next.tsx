"use client";

import { useRouter } from "next/navigation";
import { forgetUser } from "@/components/forget-user";
import type { MfaSlot } from "@/lib/auth/mfa-constants";
import { safeNextPath } from "@/lib/api/safe-next";
import { EnrolFactor } from "./enrol-factor";

/**
 * The enrolment component on a sign-in page: when the person is done the way back (`next`, made safe again here) is followed.
 * The session is now at aal2, so the cached user is forgotten and the next screen loads fresh.
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
  const router = useRouter();
  return (
    <EnrolFactor
      slot={slot}
      offerBackup={offerBackup}
      onCancel={onCancel}
      onFinished={() => {
        forgetUser();
        router.replace(safeNextPath(next));
      }}
    />
  );
}
