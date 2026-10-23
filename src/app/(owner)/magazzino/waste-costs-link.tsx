import Link from "next/link";
import { linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { canReadWasteCosts } from "@/lib/stock/stock-view";

/** The link to the waste in EUR: for owner and admin only (Q16 = V6); nothing for anyone else, or while the role is unknown. */
export function WasteCostsLink({ role }: { role: string | null }) {
  if (role === null || !canReadWasteCosts(role)) return null;
  return (
    <Link href="/magazzino/sprechi" className={`${linkClass} self-start`}>
      {t("stock.wasteCostsLink")}
    </Link>
  );
}
