import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LiHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

// Small presentational building blocks for the phone-first screens ("il registro della
// trattoria", docs/design/ui-foundation.md): every control is at least 44 px tall (the `tap`
// spacing token) and labelled. Colours come only from the tokens in globals.css.

const control =
  "min-h-tap w-full rounded-lg border border-rule-strong bg-surface px-3 text-base text-ink " +
  "shadow-[inset_0_1px_2px_rgb(0_0_0/0.05)] transition-colors duration-150 " +
  "hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-60";

/** For links set as text (back links, the signed document link). */
export const linkClass =
  "inline-flex min-h-tap items-center gap-1 font-bold text-accent-ink underline decoration-1 " +
  "underline-offset-4 transition-colors hover:decoration-2";

/** For native file inputs: the picker button is styled as a secondary button, 44 px tall. */
export const fileInputClass =
  "min-h-tap w-full max-w-full text-base text-ink-muted file:mr-3 file:min-h-tap " +
  "file:cursor-pointer file:rounded-lg file:border-[1.5px] file:border-solid file:border-olive " +
  "file:bg-surface file:px-4 file:font-bold file:text-olive hover:file:bg-sunk";

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
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.9375rem] font-bold text-ink">{label}</span>
      {children}
      {hint && <span className="text-sm leading-snug text-ink-muted">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={control} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative flex">
      <select {...props} className={`${control} appearance-none pr-10`} />
      {/* A drawn chevron: no image, so nothing extra for the CSP to allow. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-4 size-2.5 -translate-y-3/4 rotate-45 border-r-2 border-b-2 border-ink-muted"
      />
    </span>
  );
}

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-h-tap cursor-pointer items-center gap-3 self-start">
      <input type="checkbox" {...props} className="size-5 accent-accent" />
      <span>{label}</span>
    </label>
  );
}

type Variant = "primary" | "secondary" | "quiet";
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent font-bold shadow-[0_1px_0_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.12)] " +
    "hover:bg-accent-hover",
  secondary: "border-[1.5px] border-olive bg-surface text-olive font-bold hover:bg-sunk",
  quiet: "text-accent-ink font-bold underline-offset-4 hover:bg-sunk hover:underline",
};

export function Button({
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={
        "inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg px-4 text-base " +
        "transition-[background-color,transform] duration-150 active:translate-y-px " +
        `disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0 ${VARIANTS[variant]}`
      }
    />
  );
}

const NOTE =
  "rounded-lg border-l-4 px-4 py-3 leading-snug [overflow-wrap:anywhere] motion-safe:animate-rise";

export function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className={`${NOTE} border-danger bg-danger-bg text-danger`}>
      {message}
    </p>
  );
}

/** A success confirmation; the caller sets `role="status"` when it should be announced. */
export function SuccessNote({ children, role }: { children: ReactNode; role?: "status" }) {
  return (
    <p role={role} className={`${NOTE} border-success bg-success-bg text-success`}>
      {children}
    </p>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-display text-[2.25rem] leading-[1.05] font-normal tracking-[-0.015em] text-balance text-ink">
      {children}
    </h1>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[1.625rem] leading-tight font-normal text-ink">{children}</h2>
  );
}

/** A raised sheet on the paper, for a form or a group of facts. */
export function Card({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`rounded-card border border-rule bg-surface p-4 shadow-[0_1px_0_rgb(0_0_0/0.03),0_8px_24px_-16px_rgb(0_0_0/0.25)] ${className}`}
    >
      {children}
    </div>
  );
}

/** A list ruled like a ledger: hairlines between rows, rows rising in one after the other. */
export function LedgerList({ children }: { children: ReactNode }) {
  return <ul className="ledger flex flex-col border-y border-rule">{children}</ul>;
}

export function LedgerRow({ children, className = "", ...props }: LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li {...props} className={`border-b border-rule last:border-b-0 ${className}`}>
      {children}
    </li>
  );
}

/** The quiet "loading" and "empty" lines of a screen. */
export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted italic">{children}</p>;
}
