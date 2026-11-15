import type { ReactNode } from "react";

/** A fact sheet: labels in one column sized to their content, values in the other (docs/ux/costi-design-system.md §10.3). */
export function FactList({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <dl
      data-testid={testId}
      className="grid grid-cols-[auto_minmax(min-content,1fr)] gap-x-4 gap-y-2"
    >
      {children}
    </dl>
  );
}

/** A label and its value in a `FactList`. The value is a figure (`num`) that wraps; `end` right-aligns it, for a column of amounts. */
export function FactRow({
  label,
  end = false,
  testId,
  children,
}: {
  label: string;
  end?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd
        data-testid={testId}
        className={`num [overflow-wrap:anywhere]${end ? " text-right" : ""}`}
      >
        {children}
      </dd>
    </>
  );
}

/** A `FactRow` that is left out when the reading found no value (null or empty). */
export function FactDetail({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null;
  testId: string;
}) {
  if (value === null || value === "") return null;
  return (
    <FactRow label={label} testId={testId}>
      {value}
    </FactRow>
  );
}
