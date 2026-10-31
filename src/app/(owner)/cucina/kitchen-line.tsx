import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import { lineAccessibleName } from "@/lib/kitchen/kitchen-done";
import { firedLine } from "@/lib/kitchen/kitchen-view";
import type { KitchenLine as Line } from "@/server/kitchen/output";

/**
 * One dish of a comanda. An open or done dish is one big button (a tap sets "Fatto" or takes it back); a voided dish is plain text,
 * struck, with the reason in words: the kitchen stops cooking it and cannot tap it. A done dish is struck, labelled "Fatto" and
 * pressed (aria-pressed), never marked by colour alone. The server decided `done`, the order and the counts.
 */
export function KitchenLine({
  line,
  pending,
  blocked,
  onTap,
}: {
  line: Line;
  pending: boolean;
  blocked: boolean;
  onTap: () => void;
}) {
  const view = firedLine(line);
  const extras = (
    <>
      {view.shared && <Badge tone="neutral">{t("orders.line.shared")}</Badge>}
      {view.note && <span className="[overflow-wrap:anywhere]">{view.note}</span>}
    </>
  );
  if (view.voided) {
    return (
      <li data-line-id={line.id} className="flex flex-col gap-1 border-t border-rule py-2 text-lg">
        <span className="font-bold line-through [overflow-wrap:anywhere]">{view.text}</span>
        {extras}
        {view.voidText && <span className="font-bold">{view.voidText}</span>}
      </li>
    );
  }
  return (
    <li data-line-id={line.id} className="border-t border-rule text-lg">
      <button
        type="button"
        aria-pressed={view.done}
        aria-busy={pending || undefined}
        aria-label={lineAccessibleName(line)}
        disabled={blocked}
        onClick={pending ? undefined : onTap}
        className={
          "flex min-h-tap w-full min-w-tap flex-col items-start gap-1 rounded-lg px-1 py-4 text-left " +
          "transition-colors disabled:cursor-not-allowed disabled:opacity-60 " +
          (view.done ? "text-ink-muted" : "")
        }
      >
        <span className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className={`font-bold [overflow-wrap:anywhere]${view.done ? " line-through" : ""}`}>
            {view.text}
          </span>
          {view.done && <Badge tone="success">{t("kitchen.done")}</Badge>}
        </span>
        {extras}
      </button>
    </li>
  );
}
