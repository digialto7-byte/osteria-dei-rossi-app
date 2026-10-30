import { formatEuro } from "@/lib/money/format";
import { t } from "@/lib/i18n";
import { hintFor, shownPrice } from "@/lib/orders/order-view";
import type { ServiceMenuItem } from "@/server/menu/output";

/**
 * One dish of the menu, a full-width button of at least 44 px named "Aggiungi <dish>": the price (the push price while
 * pushed), "Ne restano 3" when the database says so, or a greyed "Esaurito" with `aria-disabled` when it cannot be
 * ordered. A tap adds one portion to the selected course. Names are rendered as text.
 */
export function MenuItemButton({
  item,
  onAdd,
  pinned = false,
}: {
  item: ServiceMenuItem;
  onAdd: (item: ServiceMenuItem) => void;
  pinned?: boolean;
}) {
  const note = item.available ? hintFor(item) : t("orders.item.soldOut");
  return (
    <button
      type="button"
      data-menu-item-id={item.id}
      data-pinned={pinned ? "true" : undefined}
      aria-label={t("orders.item.add", { name: item.name })}
      aria-disabled={item.available ? undefined : true}
      onClick={() => {
        if (item.available) onAdd(item);
      }}
      className={
        "flex min-h-tap w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left " +
        "transition-colors duration-150 " +
        (item.available
          ? "border-rule-strong bg-surface text-ink hover:bg-sunk"
          : "cursor-not-allowed border-rule bg-sunk text-ink-muted")
      }
    >
      <span className="flex min-w-0 flex-col">
        <span className="font-bold [overflow-wrap:anywhere]">
          {pinned && (
            <span aria-hidden="true" className="mr-1.5">
              ★
            </span>
          )}
          {item.name}
        </span>
        {note && (
          <span className={item.available ? "text-sm font-bold text-warning" : "text-sm font-bold"}>
            {note}
          </span>
        )}
      </span>
      <span className="num shrink-0">{formatEuro(shownPrice(item))}</span>
    </button>
  );
}
