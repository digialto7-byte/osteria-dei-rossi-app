import type { ReactNode } from "react";
import { Badge, Button, ErrorAlert, LedgerRow } from "@/components/ui";
import { formatEur } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import { canPush } from "@/lib/push/push-access";
import { hoursBadge, pushLine, type PushRole } from "@/lib/push/push-view";
import { formatPricePerEtto } from "@/lib/money/format";
import { formatTime } from "@/lib/time/format";
import type { PushListRow } from "@/server/push/output";

type Plate = PushListRow["plates"][number];

/** What a plate of a row says about its push: until when and, for the owner and the admin, at what price. */
function pushedText(plate: Plate, perEtto: boolean | null): string {
  const time = formatTime(new Date(plate.pushUntil!));
  const price = "pushPrice" in plate ? plate.pushPrice : null;
  // Unit not known yet (the menu read is pending or failed): the time only. A bare price could be per portion or per 100 g.
  if (price === null || perEtto === null) return t("push.pushedUntil", { time });
  // A push price is in the unit of its dish: per 100 g for a dish sold by weight (P2-0b, D-11).
  return t("push.pushedUntilPrice", {
    time,
    price: perEtto ? formatPricePerEtto(price) : formatEur(price),
  });
}

/**
 * One card of the list (M23 plan §3.5): the PRD sentence, the time left, and one line per plate that uses it. The owner and the admin push a plate
 * from here or remove its push; the chef reads the same card with no euro and no button, and a hint to ask the owner.
 */
export function PushRow({
  row,
  role,
  busy,
  onPush,
  onStop,
  error = null,
  perEtto = new Set<string>(),
  children,
}: {
  row: PushListRow;
  role: PushRole;
  busy: boolean;
  onPush: (plate: Plate) => void;
  onStop: (plate: Plate) => void;
  /** The error of a failed "Togli" of one of the row's plates. */
  error?: string | null;
  /** The menu items sold by weight (their push price is per 100 g); null while the units are not known (the push price is then not shown). */
  perEtto?: ReadonlySet<string> | null;
  /** The push sheet of one of the row's plates, when it is open. */
  children?: ReactNode;
}) {
  const manager = canPush(role);
  return (
    <LedgerRow data-push-row-id={row.id} className="flex flex-col gap-2 py-3">
      <span className="num">{pushLine(row, role)}</span>
      <Badge tone="warning">{hoursBadge(row.hoursToUseBy)}</Badge>
      {row.plates.map((plate) => (
        <div
          key={plate.menuItemId}
          data-plate-id={plate.menuItemId}
          className="flex flex-wrap items-center gap-3"
        >
          <span className="font-bold">{plate.name}</span>
          {plate.pushed ? (
            <span className="num">
              {pushedText(plate, perEtto === null ? null : perEtto.has(plate.menuItemId))}
            </span>
          ) : null}
          {manager ? (
            plate.pushed ? (
              <Button
                variant="secondary"
                disabled={busy}
                aria-label={`${t("push.action.stop")}: ${plate.name}`}
                onClick={() => onStop(plate)}
              >
                {t("push.action.stop")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={busy}
                aria-label={`${t("push.action.push")}: ${plate.name}`}
                onClick={() => onPush(plate)}
              >
                {t("push.action.push")}
              </Button>
            )
          ) : null}
        </div>
      ))}
      {!manager && row.plates.length > 0 ? (
        <span className="text-ink-muted">{t("push.chefHint")}</span>
      ) : null}
      <ErrorAlert message={error} />
      {children}
    </LedgerRow>
  );
}
