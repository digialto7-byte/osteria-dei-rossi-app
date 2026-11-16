// The selectors of the print-fill rule (costi-design-system §10.5, alignment plan D1): every fill prints white with black words and a
// 1 px inset outline. Shared by print-css.test.ts (the rule in globals.css lists exactly these) and print-fills.test.ts (every filled
// component matches one of them). A new filled component goes on the list in print-fills.test.ts.
export const PRINT_FILLS = [
  "span[data-tone]",
  ".bg-accent",
  ".bg-highlight",
  ".bg-gold",
  ".bg-ink",
  ".bg-success-bg",
  ".bg-warning-bg",
  ".bg-danger-bg",
  ".bg-info-bg",
] as const;
