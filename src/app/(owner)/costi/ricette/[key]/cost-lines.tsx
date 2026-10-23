import { Badge, LedgerList, LedgerRow } from "@/components/ui";
import { costLineText, reasonText } from "@/lib/costing/cost-view";
import type { CostLine } from "@/server/costing/types";

/** The lines of a recipe version with what each one costs, worded from the API's figures. */
export function CostLines({ lines }: { lines: CostLine[] }) {
  return (
    <LedgerList>
      {lines.map((line) => (
        <LedgerRow key={line.position} className="flex flex-col gap-1.5 py-3">
          <span className="[overflow-wrap:anywhere]">{line.target.name}</span>
          {line.incomplete && <Badge tone="warning">{reasonText(line.reason ?? "unknown")}</Badge>}
          <p className="num text-sm text-ink-muted">{costLineText(line)}</p>
        </LedgerRow>
      ))}
    </LedgerList>
  );
}
