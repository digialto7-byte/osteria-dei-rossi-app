import { FactRow } from "@/components/fact-list";
import { formatEuro } from "@/lib/money/format";

/** A cost row of the recipe card; a cost that could not be worked out (null) is left out. `strong` marks the card's one figure (§10.4). */
export function CostFact({
  label,
  value,
  testId,
  strong = false,
}: {
  label: string;
  value: number | null;
  testId: string;
  strong?: boolean;
}) {
  if (value === null) return null;
  const text = formatEuro(value);
  return (
    <FactRow label={label} testId={testId} figure>
      {strong ? <strong>{text}</strong> : text}
    </FactRow>
  );
}
