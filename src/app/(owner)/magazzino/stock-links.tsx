import Link from "next/link";
import { linkClass } from "@/components/ui";
import { canCount, canReadAudit } from "@/lib/counts/count-view";
import { t } from "@/lib/i18n";

/**
 * The count links of the /magazzino header: the counts and the reconciliation for owner, admin and chef, the activity
 * log for owner and admin. Nothing while the role is unknown, and nothing for the waiter.
 */
export function StockLinks({ role }: { role: string | null }) {
  if (role === null || !canCount(role)) return null;
  return (
    <div className="flex flex-wrap gap-x-5">
      <Link href="/magazzino/conteggi" className={linkClass}>
        {t("stock.countsLink")}
      </Link>
      <Link href="/magazzino/riconciliazione" className={linkClass}>
        {t("stock.reconciliationLink")}
      </Link>
      {canReadAudit(role) && (
        <Link href="/registro" className={linkClass}>
          {t("stock.auditLink")}
        </Link>
      )}
    </div>
  );
}
