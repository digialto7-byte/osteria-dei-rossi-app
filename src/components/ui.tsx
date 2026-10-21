import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

// Small presentational building blocks for the phone-first screens: every control is at least
// 44 px tall (the `tap` spacing token) and labelled.

const control = "min-h-tap w-full rounded border border-stone-400 bg-white px-3 text-base";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-sm text-stone-600">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={control} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={control} />;
}

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-h-tap items-center gap-3">
      <input type="checkbox" {...props} className="size-5" />
      <span>{label}</span>
    </label>
  );
}

type Variant = "primary" | "secondary";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-brand-contrast font-semibold",
  secondary: "border border-stone-400 bg-white font-medium",
};

export function Button({
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-tap min-w-tap rounded px-4 disabled:opacity-60 ${VARIANTS[variant]}`}
    />
  );
}

export function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-900">
      {message}
    </p>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-semibold">{children}</h1>;
}
