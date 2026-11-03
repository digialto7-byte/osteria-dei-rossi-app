// Process runner shared by the backup scripts (M25 step 10). The scripts take it as a dependency so tests can fake it.
import { spawnSync } from "node:child_process";

export type RunResult = { status: number | null; stdout: string; stderr: string };
export type Runner = (
  command: string,
  args: string[],
  options?: { cwd?: string; input?: string },
) => RunResult;

/** Runs a command without a shell. `input` goes to stdin (the gpg passphrase); it is never an argument. */
export const spawnRunner: Runner = (command, args, options) => {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    input: options?.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};
