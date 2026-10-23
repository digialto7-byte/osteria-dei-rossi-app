import { Badge, Button, LedgerRow } from "@/components/ui";
import { t } from "@/lib/i18n";
import { staffActions, staffBadges, type StaffItem } from "@/lib/staff-auth/staff-view";

/**
 * One person of /personale: the name, badges that say a word (role, deactivated, locked until, email login)
 * and 44 px actions. No login time of the person is shown (project Q10).
 */
export function StaffRow({
  item,
  busy,
  onPin,
  onToggle,
  onRole,
}: {
  item: StaffItem;
  busy: boolean;
  onPin: (item: StaffItem) => void;
  onToggle: (item: StaffItem) => void;
  onRole: (item: StaffItem) => void;
}) {
  const nameId = `staff-${item.id}-name`;
  const actions = staffActions(item);
  return (
    <LedgerRow className="flex flex-col gap-2 py-3">
      <span id={nameId} className="font-bold [overflow-wrap:anywhere]">
        {item.displayName}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {staffBadges(item).map((badge) => (
          <Badge key={badge.label} tone={badge.tone}>
            {badge.label}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.pin && (
          <Button
            variant="secondary"
            disabled={busy}
            aria-describedby={nameId}
            onClick={() => onPin(item)}
          >
            {t("staff.changePin")}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy}
          aria-describedby={nameId}
          onClick={() => onToggle(item)}
        >
          {t(actions.toggle === "deactivate" ? "staff.deactivate" : "staff.reactivate")}
        </Button>
        <Button
          variant="quiet"
          disabled={busy}
          aria-describedby={nameId}
          onClick={() => onRole(item)}
        >
          {t("staff.changeRole")}
        </Button>
      </div>
    </LedgerRow>
  );
}
