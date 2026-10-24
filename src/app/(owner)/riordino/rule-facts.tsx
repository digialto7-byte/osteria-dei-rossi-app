import type { ReactNode } from "react";

/** Read-only facts of a rule card (the chef's view): a definition list in the house style, values in `.num`. */
export function RuleFacts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.map((row) => (
        <div key={row.label} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-ink-muted">{row.label}</dt>
          <dd className="num">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
