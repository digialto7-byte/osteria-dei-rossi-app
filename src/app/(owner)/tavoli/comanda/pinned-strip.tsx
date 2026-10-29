import { t } from "@/lib/i18n";
import type { ServiceMenuItem } from "@/server/menu/output";
import { MenuItemButton } from "./menu-item-button";

/**
 * "Da proporre": the dishes the kitchen wants pushed today, first on the screen. The star and the words say it, so it
 * never rests on colour. The list and its order come from the API (`pinned`); nothing is sorted here. A pushed dish
 * with no portions left stays, greyed. Absent when nothing is pinned.
 */
export function PinnedStrip({
  items,
  onAdd,
}: {
  items: ServiceMenuItem[];
  onAdd: (item: ServiceMenuItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={t("orders.pinned.title")} className="flex flex-col gap-2">
      <h2 className="text-base font-bold text-ink">
        <span aria-hidden="true">★ </span>
        {t("orders.pinned.title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <MenuItemButton item={item} onAdd={onAdd} pinned />
          </li>
        ))}
      </ul>
    </section>
  );
}
