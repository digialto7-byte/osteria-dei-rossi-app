import { Checkbox, LedgerRow } from "@/components/ui";

/** One active stock ingredient with its "critical" flag: a labelled checkbox in a 44 px row. The server decides. */
export function CriticalRow({
  item,
  busy,
  onChange,
}: {
  item: { ingredientId: string; name: string; baseUnit: string; isCritical: boolean };
  busy: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <LedgerRow>
      <Checkbox
        label={item.name}
        checked={item.isCritical}
        disabled={busy}
        onChange={(event) => onChange(event.target.checked)}
      />
    </LedgerRow>
  );
}
