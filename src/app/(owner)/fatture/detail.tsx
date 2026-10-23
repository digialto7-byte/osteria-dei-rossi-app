/** One label and value row of a fact sheet; a value the reading did not find is left out. */
export function Detail({
  label,
  value,
  testId,
  numeric = false,
}: {
  label: string;
  value: string | null;
  testId: string;
  numeric?: boolean;
}) {
  if (value === null || value === "") return null;
  return (
    <>
      <dt className="pr-4 text-ink-muted">{label}</dt>
      <dd data-testid={testId} className={numeric ? "num" : "[overflow-wrap:anywhere]"}>
        {value}
      </dd>
    </>
  );
}

/**
 * The grid of a fact sheet: label column, value column, hairlines between rows. The value column is
 * never narrower than its longest unbreakable value (a date, an amount); the labels wrap instead.
 */
export const DETAIL_LIST_CLASS =
  "grid grid-cols-[auto_minmax(min-content,1fr)] [&>*]:flex [&>*]:min-w-0 [&>*]:items-center [&>*]:border-b [&>*]:border-rule [&>*]:py-3 [&>:nth-last-child(-n+2)]:border-b-0";
