import type { ReactNode } from "react";

/** A fact sheet: labels in one column sized to their content, values in the other (docs/ux/costi-design-system.md §10.3). */
export function FactList({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(min-content,1fr)] gap-x-4 gap-y-2">{children}</dl>
  );
}

/** A label and its value in a `FactList`. The value is a figure (`num`) that wraps; `end` right-aligns it, for a column of amounts. */
export function FactRow({
  label,
  end = false,
  children,
}: {
  label: string;
  end?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`num [overflow-wrap:anywhere]${end ? " text-right" : ""}`}>{children}</dd>
    </>
  );
}
