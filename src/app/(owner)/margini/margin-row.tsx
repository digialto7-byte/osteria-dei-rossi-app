import Link from "next/link";
import { Badge, LedgerRow } from "@/components/ui";
import { marginLine, marginStatusView } from "@/lib/costing/cost-view";
import type { PlateMarginPct } from "@/server/costing/types";

/**
 * One plate of the chef's margin list: percentages and a status word, nothing in euro (V6.2). It
 * reads only the six fields of PlateMarginPct, so a stray extra field is never rendered.
 */
export function MarginRow({ plate }: { plate: PlateMarginPct }) {
  const status = marginStatusView(plate.status);
  const line = marginLine(plate);
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <Link
        href={`/margini/${plate.recipeKey}`}
        className="inline-flex min-h-tap items-center self-start font-bold [overflow-wrap:anywhere] underline-offset-4 hover:underline"
      >
        {plate.name}
      </Link>
      <Badge tone={status.tone}>{status.label}</Badge>
      {line && <p className="num text-sm text-ink-muted">{line}</p>}
    </LedgerRow>
  );
}
