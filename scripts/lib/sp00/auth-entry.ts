// SP0 spike (§3.5, S11): the logic of `scripts/spike/sp00-auth.ts`: arguments, the target guard (before any client exists), the
// preflight, the checks in order, one JSON line per check. The clients are built by `io.buildContext`, called only after the guard.
import { parseArgs } from "node:util";
import { errorName } from "./common";
import { buildReport, formatReport, type CaseReport, type Cleanup } from "./report";
import { resolveSpikeTarget, type Env, type SpikeTargetName } from "./target";

export type CheckName = "preflight" | "t1" | "t2" | "t3" | "t5";
type RunnableName = Exclude<CheckName, "preflight">;

const ALLOWED: readonly CheckName[] = ["preflight", "t1", "t2", "t3", "t5"];
/** The order the checks run in: T5 first, as nothing else should depend on a user another check left behind. */
const CANONICAL: readonly CheckName[] = ["preflight", "t5", "t1", "t2", "t3"];

export interface AuthArgs {
  target: SpikeTargetName;
  checks: CheckName[];
}

export function parseAuthArgs(argv: string[]): AuthArgs {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: { target: { type: "string" }, checks: { type: "string" } },
  });
  if (values.target === undefined) throw new Error("--target is required: local or temp.");
  if (values.target !== "local" && values.target !== "temp")
    throw new Error("--target accepts only: local or temp.");
  const target = values.target;

  let requested: CheckName[];
  if (values.checks === undefined) {
    requested = CANONICAL.filter((name) => target === "temp" || name !== "preflight");
  } else {
    const names = values.checks.split(",");
    for (const name of names) {
      if (!ALLOWED.includes(name as CheckName)) {
        throw new Error("--checks accepts only: preflight, t1, t2, t3, t5 (comma separated).");
      }
    }
    if (new Set(names).size !== names.length)
      throw new Error("--checks names a check more than once.");
    requested = names as CheckName[];
  }
  if (target === "local" && requested.includes("preflight")) {
    throw new Error("The preflight applies to the hosted run (--target temp) only.");
  }
  // Hosted runs always start with the preflight: every check there needs the secret key.
  const wanted = new Set<CheckName>(target === "temp" ? ["preflight", ...requested] : requested);
  return { target, checks: CANONICAL.filter((name) => wanted.has(name)) };
}

/** The `version` of GoTrue's `/auth/v1/health` answer, when it looks like a version. */
export function parseAuthVersion(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const version = (body as { version?: unknown }).version;
  return typeof version === "string" && /^[A-Za-z0-9._+-]{1,40}$/.test(version) ? version : null;
}

export async function readAuthVersion(
  fetchImpl: typeof fetch,
  supabaseUrl: string,
  publishableKey: string,
): Promise<string | null> {
  const response = await fetchImpl(`${supabaseUrl}/auth/v1/health`, {
    headers: { apikey: publishableKey },
  });
  if (response.status !== 200) return null;
  return parseAuthVersion(await response.json());
}

export interface CheckOutcome {
  cases: CaseReport[];
  cleanup: Cleanup;
}

export interface AuthContext {
  /** Values that must never appear in a report (the secret key placeholder). */
  secrets: string[];
  preflight(): Promise<CaseReport>;
  authVersion(): Promise<string | null>;
  /** Each check takes the preflight result (null locally) and returns its cases and cleanup. */
  checks: Record<RunnableName, (preflight: CaseReport | null) => Promise<CheckOutcome>>;
}

export interface EntryIo {
  argv: string[];
  env: Env;
  /** Builds the clients. Called only after the target guard has passed. */
  buildContext(input: { target: SpikeTargetName; env: Env }): AuthContext;
  print(line: string): void;
  printError(message: string): void;
}

const NO_CLEANUP: Cleanup = { created: 0, deleted: 0, kept: 0 };

export async function runAuthEntry(io: EntryIo): Promise<number> {
  let args: AuthArgs;
  try {
    args = parseAuthArgs(io.argv);
    resolveSpikeTarget({
      target: args.target,
      env: io.env,
      supabaseUrl: io.env.SPIKE_SUPABASE_URL ?? "",
    });
  } catch (error) {
    io.printError(error instanceof Error ? error.message : "refused");
    return 1;
  }

  const context = io.buildContext({ target: args.target, env: io.env });
  let authVersion: string;
  try {
    authVersion = (await context.authVersion()) ?? "unknown";
  } catch (error) {
    io.printError(`Auth could not be reached for its version (${errorName(error)}).`);
    return 1;
  }

  let allOk = true;
  const emit = (check: string, outcome: CheckOutcome) => {
    const report = buildReport({
      target: args.target,
      check,
      cases: outcome.cases,
      cleanup: outcome.cleanup,
      authVersion,
    });
    try {
      io.print(formatReport(report, context.secrets));
    } catch (error) {
      io.printError(error instanceof Error ? error.message : "report refused");
      allOk = false;
      return;
    }
    if (!report.ok) allOk = false;
  };

  let preflight: CaseReport | null = null;
  for (const name of args.checks) {
    if (name === "preflight") {
      try {
        preflight = await context.preflight();
      } catch (error) {
        preflight = {
          id: "preflight",
          result: "inconclusive",
          detail: { reason: "preflight crashed", error: errorName(error) },
        };
      }
      emit("preflight", { cases: [preflight], cleanup: NO_CLEANUP });
      continue;
    }
    let outcome: CheckOutcome;
    try {
      outcome = await context.checks[name](preflight);
    } catch (error) {
      outcome = {
        cases: [
          {
            id: "run",
            result: "inconclusive",
            detail: { reason: "check crashed", error: errorName(error) },
          },
        ],
        cleanup: NO_CLEANUP,
      };
    }
    emit(name, outcome);
  }
  return allOk ? 0 : 1;
}
