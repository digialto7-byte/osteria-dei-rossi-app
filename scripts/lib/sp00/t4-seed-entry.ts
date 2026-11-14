// SP0 spike (§3.5, S12): the logic of `scripts/spike/sp00-t4-seed.ts`: --target, the target guard before any client, the preflight (hosted), the seed,
// one JSON line. The clients are built by `io.buildContext`, called only after the guard.
import { parseArgs } from "node:util";
import { errorName } from "./common";
import type { CaseReport } from "./report";
import { resolveSpikeTarget, type Env, type SpikeTargetName } from "./target";
import { formatT4Seed, type T4SeedResult } from "./t4-seed";

export function parseSeedArgs(argv: string[]): { target: SpikeTargetName } {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: { target: { type: "string" } },
  });
  if (values.target === undefined) throw new Error("--target is required: local or temp.");
  if (values.target !== "local" && values.target !== "temp")
    throw new Error("--target accepts only: local or temp.");
  return { target: values.target };
}

export interface SeedContext {
  /** Values that must never appear in the output. */
  secrets: string[];
  preflight(): Promise<CaseReport>;
  seed(preflight: CaseReport | null): Promise<T4SeedResult>;
}

export interface SeedEntryIo {
  argv: string[];
  env: Env;
  /** Builds the clients. Called only after the target guard has passed. */
  buildContext(input: { target: SpikeTargetName; env: Env }): SeedContext;
  print(line: string): void;
  printError(message: string): void;
}

export async function runT4SeedEntry(io: SeedEntryIo): Promise<number> {
  let target: SpikeTargetName;
  try {
    target = parseSeedArgs(io.argv).target;
    resolveSpikeTarget({ target, env: io.env, supabaseUrl: io.env.SPIKE_SUPABASE_URL ?? "" });
  } catch (error) {
    io.printError(error instanceof Error ? error.message : "refused");
    return 1;
  }
  const context = io.buildContext({ target, env: io.env });
  let result: T4SeedResult;
  try {
    const preflight = target === "temp" ? await context.preflight() : null;
    result = await context.seed(preflight);
  } catch (error) {
    io.printError(`The T4 seed crashed (${errorName(error)}).`);
    return 1;
  }
  try {
    io.print(formatT4Seed(target, result, context.secrets));
  } catch (error) {
    io.printError(error instanceof Error ? error.message : "report refused");
    return 1;
  }
  return result.ok ? 0 : 1;
}
