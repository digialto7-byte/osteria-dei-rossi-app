"use client";

import { EnrolFactor, type EnrolPaths } from "@/components/mfa/enrol-factor";
import { safeNextPath } from "@/lib/api/safe-next";

/** The console's enrolment routes: the account pair, never the venue's /api/me/mfa. Module-level, so the object is the same on every render. */
const ACCOUNT_ENROL_PATHS: EnrolPaths = {
  start: "/api/auth/mfa/account/factors",
  verify: (factorId) => `/api/auth/mfa/account/factors/${factorId}/verify`,
};

/**
 * The console's forced enrolment: the shared `EnrolFactor` on the account paths, a backup offered after the first factor. When the person is
 * done the way back (`next`, made safe again here) is followed with a full document load: this page's CSP allows data: images, and a
 * client navigation would carry that on to the next screen.
 */
export function ConsoleEnrol({ next }: { next: string | undefined }) {
  return (
    <EnrolFactor
      slot="principale"
      offerBackup
      paths={ACCOUNT_ENROL_PATHS}
      onFinished={() => window.location.assign(safeNextPath(next))}
    />
  );
}
