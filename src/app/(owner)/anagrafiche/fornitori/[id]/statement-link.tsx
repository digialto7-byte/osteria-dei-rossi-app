import Link from "next/link";
import { linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { canReadPayables } from "@/lib/payables/payable-view";

/** "Estratto conto": shown to owner and admin only (the API refuses the others anyway). */
export function StatementLink({ supplierId, role }: { supplierId: string; role: string | null }) {
  if (role === null || !canReadPayables(role)) return null;
  return (
    <Link
      href={`/anagrafiche/fornitori/${supplierId}/estratto-conto`}
      className={`${linkClass} self-start`}
    >
      {t("statement.link")}
    </Link>
  );
}
