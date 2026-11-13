"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EnrolToNext } from "@/components/mfa/enrol-to-next";
import { Button, Muted } from "@/components/ui";
import { safeNextPath } from "@/lib/api/safe-next";
import { t } from "@/lib/i18n";

/** The offer: "Attiva ora" opens the enrolment of the main device, "Non ora" goes on. Nothing is sent until a button is pressed. */
export function OfferScreen({ next }: { next: string | undefined }) {
  const router = useRouter();
  const [enrolling, setEnrolling] = useState(false);

  if (enrolling) return <EnrolToNext next={next} onCancel={() => setEnrolling(false)} />;
  return (
    <div className="flex flex-col gap-4">
      <Muted>{t("mfa.offer.text")}</Muted>
      <Button onClick={() => setEnrolling(true)}>{t("mfa.offer.now")}</Button>
      <Button variant="quiet" onClick={() => router.replace(safeNextPath(next))}>
        {t("mfa.offer.later")}
      </Button>
    </div>
  );
}
