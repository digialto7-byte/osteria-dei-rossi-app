import type { ReactNode } from "react";
import { FactList, FactRow } from "@/components/fact-list";

/** Read-only facts of a rule card (the chef's view): a `FactList`, values in `.num`. */
export function RuleFacts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <FactList>
      {rows.map((row) => (
        <FactRow key={row.label} label={row.label}>
          {row.value}
        </FactRow>
      ))}
    </FactList>
  );
}
