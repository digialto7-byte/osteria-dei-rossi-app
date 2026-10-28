// Shared look of the shell's links: the current one is ink-filled with aria-current (the pill style of
// the old OwnerNav), the others are plain. Tokens only; every link is at least 44 px tall.

const BASE = "inline-flex min-h-tap items-center transition-colors duration-150 ";

export const pillClass = (current: boolean): string =>
  BASE +
  "rounded-full border px-3.5 text-[0.9375rem] " +
  (current
    ? "border-ink bg-ink font-bold text-paper"
    : "border-rule bg-surface text-ink hover:border-rule-strong hover:bg-sunk");

export const tabClass = (current: boolean): string =>
  "flex min-h-tap flex-1 items-center justify-center rounded-lg px-1 text-[0.9375rem] " +
  "transition-colors duration-150 " +
  (current ? "bg-ink font-bold text-paper" : "text-ink hover:bg-sunk");

export const sidebarLinkClass = (current: boolean): string =>
  BASE +
  "w-full rounded-lg px-3 text-[0.9375rem] " +
  (current ? "bg-ink font-bold text-paper" : "text-ink hover:bg-sunk");
