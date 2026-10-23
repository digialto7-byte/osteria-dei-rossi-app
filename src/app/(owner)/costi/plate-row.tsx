import Link from "next/link";
import { Badge, LedgerRow, linkClass } from "@/components/ui";
import { incompleteNotes, plateFigures, statusView } from "@/lib/costing/cost-view";
import type { PlateCost } from "@/server/costing/types";

/**
 * One plate of the cost list. Every figure and the status word come from the API; this only words
 * them. The status is a word in a badge, never colour alone.
 */
export function PlateRow({ plate }: { plate: PlateCost }) {
  const status = statusView(plate.status);
  const figures = plateFigures(plate);
  const notes = incompleteNotes(plate);
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <span className="[overflow-wrap:anywhere]">
        <Link href={`/costi/ricette/${plate.recipeKey}`} className={linkClass}>
          {plate.name}
        </Link>
      </span>
      <Badge tone={status.tone}>{status.label}</Badge>
      {figures.costLine && <p className="num text-sm text-ink-muted">{figures.costLine}</p>}
      {figures.priceLine && <p className="num text-sm text-ink-muted">{figures.priceLine}</p>}
      {notes.map((note) => (
        <p key={note} className="text-sm text-warning [overflow-wrap:anywhere]">
          {note}
        </p>
      ))}
    </LedgerRow>
  );
}
