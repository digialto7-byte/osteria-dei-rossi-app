import { t } from "@/lib/i18n";
import { itemsForCourse } from "@/lib/orders/order-view";
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import type { Course } from "@/server/orders/constants";
import { MenuItemButton } from "./menu-item-button";

/**
 * The panel of the selected tab: the dishes of that course, grouped by category in the API's order, then the rest of
 * the menu under a collapsed "Altri piatti". The split is a field match (`itemsForCourse`), never a category name.
 */
export function MenuSection({
  course,
  menu,
  onAdd,
}: {
  course: Course;
  menu: ServiceMenu;
  onAdd: (item: ServiceMenuItem) => void;
}) {
  const { groups, others } = itemsForCourse(menu, course);
  return (
    <div
      role="tabpanel"
      id={`panel-${course}`}
      aria-labelledby={`tab-${course}`}
      className="flex flex-col gap-4"
    >
      {groups.map((group) => (
        <section key={group.name} aria-label={group.name} className="flex flex-col gap-2">
          <h3 className="text-base font-bold text-ink-muted">{group.name}</h3>
          <ul className="flex flex-col gap-2">
            {group.items.map((item) => (
              <li key={item.id}>
                <MenuItemButton item={item} onAdd={onAdd} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {others.length > 0 && (
        <details className="flex flex-col gap-2">
          <summary className="flex min-h-tap cursor-pointer items-center font-bold text-accent-ink">
            {t("orders.others")}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {others.map((item) => (
              <li key={item.id}>
                <MenuItemButton item={item} onAdd={onAdd} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
