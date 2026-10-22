// Decides whether the live contract run can start (M3 plan §3, contract tests). Pure: the caller
// passes the folder listing and the environment, and only variable NAMES ever leave this module.

/** Invoices the AT8 run needs before it is worth calling the paid API. */
export const MIN_CONTRACT_INVOICES = 10;
export const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "EXTRACTION_MODEL_ID"] as const;

const DOCUMENT = /^([a-z0-9-]+)\.(pdf|jpg|png)$/;
const EXPECTED = /^([a-z0-9-]+)\.expected\.json$/;

export interface ContractPair {
  stem: string;
  document: string;
  expected: string;
}

/** `<name>.{pdf,jpg,png}` with `<name>.expected.json`; names are lower-case letters, digits, "-". */
export function listPairs(files: readonly string[]): ContractPair[] {
  const expected = new Set(files.flatMap((file) => EXPECTED.exec(file)?.[1] ?? []));
  const pairs = new Map<string, ContractPair>();
  for (const file of [...files].sort()) {
    const stem = DOCUMENT.exec(file)?.[1];
    if (stem && expected.has(stem) && !pairs.has(stem)) {
      pairs.set(stem, { stem, document: file, expected: `${stem}.expected.json` });
    }
  }
  return [...pairs.values()];
}

export interface PreflightResult {
  ready: boolean;
  missing: string[];
}

export function preflight(input: {
  files: readonly string[];
  env: Record<string, string | undefined>;
}): PreflightResult {
  const missing: string[] = REQUIRED_ENV.filter((name) => !input.env[name]?.trim());
  const found = listPairs(input.files).length;
  if (found < MIN_CONTRACT_INVOICES) {
    missing.push(`${MIN_CONTRACT_INVOICES} invoices (found ${found})`);
  }
  return { ready: missing.length === 0, missing };
}

/** The GitHub Actions annotation shown when the run is skipped. */
export function renderPreflightNotice(result: PreflightResult): string {
  return `::notice title=Contract run skipped::${result.missing.join(", ")}`;
}
