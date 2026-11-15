import Link from "next/link";
import { kitchenCardText, type KitchenCardState } from "@/lib/kitchen/kitchen-view";

/**
 * The chef's Home card: how many comande are open and how many dishes are still to make. The whole card is one link to
 * /cucina, styled as a card and not as the primary action. A pure view: the page owns the read (useKitchenSummary).
 */
export function KitchenCard({ state }: { state: KitchenCardState }) {
  const { title, detail, action } = kitchenCardText(state);
  return (
    <Link
      href="/cucina"
      data-kitchen-card
      className="flex min-h-tap flex-col gap-1 rounded-lg border border-rule bg-surface p-4 transition-colors hover:bg-sunk"
    >
      <span className="font-display text-[1.25rem] leading-tight font-semibold">{title}</span>
      {detail && <span className="text-ink-muted">{detail}</span>}
      <span className="font-bold text-accent-ink">
        {action} <span aria-hidden="true">›</span>
      </span>
    </Link>
  );
}
