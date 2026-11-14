// SP0 spike (§3.4, S2): the one-line JSON report of a check. It holds check ids, results, booleans, status codes, counts,
// claim names and ids. formatReport refuses (throws, before anything is printed) a value that looks like a token, a key,
// an address or a URL, or that contains a secret it was told about. The refusal never repeats the value.

export type CaseResult = "pass" | "fail" | "inconclusive" | "recorded";
export type DetailValue = string | number | boolean | null;
export interface CaseReport {
  id: string;
  result: CaseResult;
  detail: Record<string, DetailValue | DetailValue[]>;
}
export interface Cleanup {
  created: number;
  deleted: number;
  kept: number;
}
export interface CheckReport {
  target: "local" | "temp";
  check: string;
  /** True when no case failed or was inconclusive. A `recorded` case has no pass rule and does not count. */
  ok: boolean;
  cases: CaseReport[];
  cleanup: Cleanup;
  authVersion: string;
}

const RESULTS: readonly string[] = ["pass", "fail", "inconclusive", "recorded"];

export function buildReport(input: Omit<CheckReport, "ok">): CheckReport {
  for (const item of input.cases) {
    if (!RESULTS.includes(item.result)) {
      throw new Error("Invalid case result: expected pass, fail, inconclusive or recorded.");
    }
  }
  for (const count of [input.cleanup.created, input.cleanup.deleted, input.cleanup.kept]) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("Invalid cleanup: counts must be whole numbers, zero or more.");
    }
  }
  const ok =
    input.cases.length > 0 &&
    input.cases.every((item) => item.result === "pass" || item.result === "recorded");
  return { ...input, ok };
}

const FORBIDDEN: readonly RegExp[] = [
  /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT-shaped
  /\bsb_/i, // Supabase key prefix
  /@/, // e-mail address
  /\b(?:https?|wss?):\/\//i, // URL
];

function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      yield key;
      yield* strings(item);
    }
  }
}

/** Throws (without repeating the value) when anything in `value` looks like a token, a key, an address or a URL, or holds one of `secrets`. */
export function assertClean(value: unknown, secrets: readonly string[]): void {
  if (secrets.some((secret) => secret === "")) {
    throw new Error("Report refused: an empty secret was given to the redaction check.");
  }
  for (const text of strings(value)) {
    if (FORBIDDEN.some((pattern) => pattern.test(text)) || secrets.some((s) => text.includes(s))) {
      throw new Error(
        "Report refused: a value looks like a token, a key, an address or a URL, or holds a secret.",
      );
    }
  }
}

/** One JSON line. `secrets` are values that must never appear (the spike's secret key placeholder). */
export function formatReport(report: CheckReport, secrets: readonly string[]): string {
  assertClean(report, secrets);
  return JSON.stringify(report);
}
