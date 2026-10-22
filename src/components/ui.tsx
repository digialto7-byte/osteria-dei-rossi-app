import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LiHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { useId } from "react";
import { t } from "@/lib/i18n";

// Small presentational building blocks for the phone-first screens, in the Osteria dei Rossi
// house style (docs/design/ui-foundation.md): every control is at least 44 px tall (the `tap`
// spacing token) and labelled. Colours come only from the tokens in globals.css.

const control =
  "min-h-tap w-full rounded-lg border border-rule-strong bg-surface px-3 text-base text-ink " +
  "shadow-[inset_0_1px_2px_rgb(0_0_0/0.05)] transition-colors duration-150 " +
  "hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-60";

/** For links set as text (back links, the signed document link). */
export const linkClass =
  "inline-flex min-h-tap items-center gap-1 font-bold text-accent-ink underline decoration-1 " +
  "underline-offset-4 transition-colors hover:decoration-2";

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

/**
 * A file input with an Italian face. The browser's own picker button ("Choose File / No file
 * chosen") cannot be translated, so the real input sits transparent over a drawn button: taps
 * and clicks reach it, it keeps its label (use inside `Field`), and `setInputFiles` and the
 * accessible name are unchanged. The drawn button and the status line are `aria-hidden` so they
 * do not join the label; the status reaches assistive tech as the input's description.
 */
export function FilePicker({
  buttonLabel = t("file.choose"),
  fileName,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  buttonLabel?: string;
  fileName: string | null | undefined;
}) {
  const statusId = useId();
  // The input covers the wrapper's border box too (inset by minus the border width), so it is
  // as tall as the drawn 44 px button, which e2e/helpers/session.ts measures.
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span
        className={
          "relative inline-flex min-h-tap shrink-0 items-center rounded-lg border-[1.5px] border-ink " +
          "bg-surface px-4 font-bold text-ink transition-colors duration-150 " +
          "has-[:hover]:bg-sunk has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 " +
          "has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-solid"
        }
      >
        <span aria-hidden="true">{buttonLabel}</span>
        <input
          type="file"
          {...props}
          aria-describedby={[props["aria-describedby"], statusId].filter(Boolean).join(" ")}
          className="absolute inset-[-1.5px] cursor-pointer opacity-0"
        />
      </span>
      <span
        id={statusId}
        aria-hidden="true"
        className={
          "min-w-0 [overflow-wrap:anywhere] " +
          (fileName ? "rounded-lg bg-sunk px-3 py-1.5 text-ink" : "text-ink-muted")
        }
      >
        {fileName ? t("file.chosen", { name: fileName }) : t("file.none")}
      </span>
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
    "bg-accent text-on-accent font-bold tracking-[0.01em] " +
    "shadow-[0_1px_0_rgb(0_0_0/0.18),inset_0_1px_0_rgb(255_255_255/0.10)] hover:bg-accent-hover",
  secondary: "border-[1.5px] border-ink bg-surface text-ink font-bold hover:bg-sunk",
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
    <h1
      className={
        "font-display text-[2.125rem] leading-[1.08] font-semibold tracking-[-0.01em] text-balance " +
        "text-ink after:mt-3 after:block after:h-0.5 after:w-12 after:bg-gold"
      }
    >
      {children}
    </h1>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[1.5rem] leading-tight font-semibold text-ink">{children}</h2>
  );
}

/** A raised sheet on the cream paper, for a form or a group of facts. */
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
  return <p className="text-ink-muted">{children}</p>;
}
