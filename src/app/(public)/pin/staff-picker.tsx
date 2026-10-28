import { Badge, LedgerList, LedgerRow, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { roleWord, type StaffEntry } from "@/lib/staff-auth/pin-view";

/** "Chi sei?": one 44 px button per person. Pure presentation; the parent decides what a tap does. */
export function StaffPicker({
  staff,
  onPick,
}: {
  staff: StaffEntry[];
  onPick: (person: StaffEntry) => void;
}) {
  if (staff.length === 0) return <Muted>{t("pin.empty")}</Muted>;
  return (
    <LedgerList>
      {staff.map((person) => (
        <LedgerRow key={person.id} className="p-0">
          <button
            type="button"
            onClick={() => onPick(person)}
            className="flex min-h-tap w-full items-center justify-between gap-3 px-4 py-3 text-left text-base font-bold text-ink hover:bg-sunk"
          >
            <span className="[overflow-wrap:anywhere]">{person.displayName}</span>
            <Badge tone="neutral">{roleWord(person.role)}</Badge>
          </button>
        </LedgerRow>
      ))}
    </LedgerList>
  );
}
