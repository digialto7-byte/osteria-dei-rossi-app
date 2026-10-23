import { Card } from "@/components/ui";
import { t } from "@/lib/i18n";
import { codeExpiryLine } from "@/lib/staff-auth/device-view";

/** The enrolment code, shown once and large. It is not stored in the page after it is closed. */
export function CodeCard({
  display,
  label,
  expiresAt,
}: {
  display: string;
  label: string;
  expiresAt: string;
}) {
  return (
    <Card role="status" className="flex flex-col gap-2">
      <p className="text-sm font-bold text-ink-muted [overflow-wrap:anywhere]">
        {t("devices.codeTitle")} · {label}
      </p>
      <p className="num text-4xl font-bold tracking-[0.12em] text-ink">{display}</p>
      <p>{codeExpiryLine(expiresAt)}</p>
    </Card>
  );
}
