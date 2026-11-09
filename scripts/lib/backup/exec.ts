// Process runner shared by the backup scripts (M25 step 10). The scripts take it as a dependency so tests can fake it.
import { spawnSync } from "node:child_process";

export type RunResult = { status: number | null; stdout: string; stderr: string };
export type Runner = (
  command: string,
  args: string[],
  options?: { cwd?: string; input?: string },
) => RunResult;

/** The environment of a child: ours without the Supabase secret key (gpg, psql and tar never need it). */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.SUPABASE_SECRET_KEY;
  return env;
}

/** Runs a command without a shell. `input` goes to stdin (the gpg passphrase); it is never an argument. */
export const spawnRunner: Runner = (command, args, options) => {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    env: childEnv(),
    input: options?.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};
