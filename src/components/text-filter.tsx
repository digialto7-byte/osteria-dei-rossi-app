// Text filters like /avvisi: the chosen one is bold and underlined, and aria-pressed says it too.
const BASE =
  "inline-flex min-h-tap items-center text-accent-ink underline-offset-4 transition-colors";
const ACTIVE = `${BASE} font-bold underline decoration-2`;
const IDLE = `${BASE} hover:underline`;

/** A row of text buttons, one of them chosen. The options and their words come from the caller. */
export function TextFilter<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (next: V) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-x-5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={value === option.value ? ACTIVE : IDLE}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
