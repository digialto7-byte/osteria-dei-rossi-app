import Link from "next/link";
import { AlertRow } from "@/app/(owner)/avvisi/alert-row";
import { Badge, ErrorAlert, LedgerList, Muted, SubHeading, linkClass } from "@/components/ui";
import type { HomeAlertsState } from "@/components/use-home-alerts";
import { t } from "@/lib/i18n";
import type { TodayBadge } from "@/lib/nav/today-actions";

/**
 * The first block of Home for the owner and the chef (M25b): the newest open alerts with "Ho visto", the alerts badge from the counts and the link
 * to all of them. A pure view: the page owns the reads. The badge text comes from `badgeFor`, never counted here.
 */
export function HomeAlertsView({
  status,
  alerts,
  badge,
  busyId,
  error,
  onAcknowledge,
}: Pick<HomeAlertsState, "status" | "alerts" | "busyId" | "error"> & {
  badge: TodayBadge | null;
  onAcknowledge: (id: string) => void;
}) {
  return (
    <section aria-labelledby="home-alerts-title" className="flex flex-col gap-3">
      <SubHeading id="home-alerts-title">{t("home.alerts")}</SubHeading>
      {badge && (
        <p>
          <Badge tone={badge.tone}>{t(badge.labelKey, { count: badge.count ?? 0 })}</Badge>
        </p>
      )}
      <ErrorAlert message={error} />
      {status === "loading" && <Muted>{t("common.loading")}</Muted>}
      {status === "ok" &&
        (alerts.length === 0 ? (
          <Muted>{t("home.alerts.empty")}</Muted>
        ) : (
          <LedgerList>
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                busy={busyId === alert.id}
                onAcknowledge={onAcknowledge}
              />
            ))}
          </LedgerList>
        ))}
      <div>
        <Link href="/avvisi" className={linkClass}>
          {t("home.alerts.all")}
        </Link>
      </div>
    </section>
  );
}
