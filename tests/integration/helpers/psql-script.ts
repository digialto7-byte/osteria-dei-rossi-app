import { execFileSync } from "node:child_process";
import { assertLocalDbUrl } from "./sql";

type RunWithInput = (
  file: string,
  args: string[],
  options: { encoding: "utf8"; input: string },
) => string;

const defaultRun: RunWithInput = (file, args, options) => execFileSync(file, args, options);

/**
 * Runs a whole SQL script through psql (stdin) and returns the tab-separated result rows, header first. The URL is checked
 * BEFORE psql is spawned, so a non-local URL sends no SQL at all (same rule as runSql in ./sql). Test code only.
 */
export function runScriptLocal(
  script: string,
  url: string,
  run: RunWithInput = defaultRun,
): string[][] {
  assertLocalDbUrl(url);
  const out = run(
    "psql",
    ["-X", "-v", "ON_ERROR_STOP=1", "-A", "-F", "\t", "-P", "footer=off", url],
    { encoding: "utf8", input: script },
  );
  return out
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => line.split("\t"));
}
