import { labelLines } from "@/lib/batches/batch-view";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { BatchLabel } from "@/server/batches/types";

/**
 * The text of the label, to copy by hand onto the real one (printing is a later phase). A narrow column like a 62 mm
 * label, black on white in both themes so it reads like the paper it stands for. The lines are the API's facts worded
 * in Europe/Rome; the first, the recipe, is bold.
 */
export function LabelText({
  label,
  locale = DEFAULT_LOCALE,
}: {
  label: BatchLabel;
  locale?: Locale;
}) {
  const [name, ...rest] = labelLines(label, locale);
  return (
    <div
      data-testid="label-text"
      className="num flex w-full max-w-[17rem] flex-col gap-1 rounded-lg border border-rule-strong bg-white p-4 text-black"
    >
      <p className="font-bold [overflow-wrap:anywhere]">{name}</p>
      {rest.map((line) => (
        <p key={line} className="[overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
    </div>
  );
}
