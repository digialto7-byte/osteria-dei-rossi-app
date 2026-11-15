import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFA_RESET_CONFIRM_TEXT } from "../../scripts/lib/mfa-admin";

// SP3 step 6 (plan sections 3.9.3 and 3.13): every secret-key script runs as a job of one manual workflow in the protected environment `platform-ops`,
// approved by the founder. The repository is public, so the run log and the inputs are readable by anyone: inputs carry ids and codes only, secrets reach
// the scripts only as `env:` from `secrets.*`, and what a job prints is masked first and short. These checks read the YAML as text (no YAML parser is a dependency).
const path = new URL("../../.github/workflows/platform-ops.yml", import.meta.url);
const workflow = existsSync(path) ? readFileSync(path, "utf8") : "";

/** Secret names of the environment (plan section 9a FS-1, plus the four tenant-creation values the lead moved from inputs to secrets on 2026-11-15). */
const SECRET_NAMES = [
  "OWNER_EMAIL",
  "OWNER_NAME",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_URL",
  "TENANT_NAME",
  "TENANT_VAT_NUMBER",
];
const SECRET_JOBS = ["mfa-reset", "set-mfa-enforcement", "create-tenant"];

/** The text of each job, by name: from its two-space-indented key to the next one. */
function jobs(): Record<string, string> {
  const body = workflow.slice(workflow.search(/^jobs:$/m));
  const parts = body.split(/\n(?= {2}[a-z][a-z0-9-]*:\s*$)/m).slice(1);
  return Object.fromEntries(parts.map((part) => [part.trim().split(":")[0] ?? "", part]));
}

/** The `on:` block: from `on:` to the next top-level key. */
function onBlock(): string {
  const start = workflow.search(/^on:$/m);
  const rest = workflow.slice(start + 3);
  const end = rest.search(/^\S/m);
  return rest.slice(0, end === -1 ? undefined : end);
}

/** Names of the workflow_dispatch inputs (four-space indented keys under `inputs:`). */
function inputNames(): string[] {
  return [...onBlock().matchAll(/^ {6}([a-z_]+):\s*$/gm)].map((m) => m[1] ?? "");
}

/** The shell text of every `run:` step in a job (inline or block). */
function runBlocks(job: string): string[] {
  const out: string[] = [];
  const lines = job.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    const indent = (m[1] ?? "").length;
    if (m[2] && !/^[|>][+-]?$/.test(m[2])) {
      out.push(m[2]);
      continue;
    }
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? "";
      if (line.trim() !== "" && line.search(/\S/) <= indent + 1) break;
      block.push(line);
    }
    out.push(block.join("\n"));
  }
  return out;
}

describe("platform-ops workflow", () => {
  it("exists", () => {
    expect(workflow).not.toBe("");
  });

  it("is started by hand only: no push, pull request, schedule or other trigger", () => {
    expect(onBlock()).toMatch(/^\s+workflow_dispatch:/m);
    expect(onBlock().match(/^ {2}[a-z_]+:/gm)).toEqual(["  workflow_dispatch:"]);
    expect(workflow).not.toMatch(
      /^\s*(push|pull_request|pull_request_target|schedule|workflow_run|workflow_call|repository_dispatch):/m,
    );
  });

  it("has the jobs summary, mfa-reset, set-mfa-enforcement and create-tenant, and no other", () => {
    expect(Object.keys(jobs()).sort()).toEqual([...SECRET_JOBS, "summary"].sort());
  });

  it("pins the runner image (ci-runner-image rule), a read-only token and no persisted credentials", () => {
    const runners = [...workflow.matchAll(/runs-on: (.+)/g)].map((m) => m[1]);
    expect(runners).toHaveLength(4);
    expect(new Set(runners)).toEqual(new Set(["ubuntu-24.04"]));
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(3);
  });

  it("every job runs only from main", () => {
    for (const [name, job] of Object.entries(jobs()))
      expect(job, name).toContain("github.ref == 'refs/heads/main'");
  });
});

describe("platform-ops workflow: approval (plan 3.13)", () => {
  it("the summary job has no environment and reads no secret", () => {
    const summary = jobs().summary ?? "";
    expect(summary).not.toMatch(/^\s+environment:/m);
    expect(summary).not.toContain("secrets.");
  });

  it("every job that reads a secrets.* value has environment platform-ops and needs the summary job", () => {
    const withSecrets = Object.entries(jobs()).filter(([, job]) => /\$\{\{\s*secrets\./.test(job));
    expect(withSecrets.map(([name]) => name).sort()).toEqual([...SECRET_JOBS].sort());
    for (const [name, job] of withSecrets) {
      expect(job, name).toMatch(/^ {4}environment: platform-ops$/m);
      expect(job, name).toMatch(/^ {4}needs: summary$/m);
    }
  });

  it("a job without secrets has no environment of its own to hide behind: only platform-ops is ever named", () => {
    expect([...workflow.matchAll(/environment:\s*(\S+)/g)].map((m) => m[1])).toEqual([
      "platform-ops",
      "platform-ops",
      "platform-ops",
    ]);
  });

  it("reads exactly the secret names of the environment, each only in a step env, never at job level", () => {
    const used = [...new Set([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
    expect(used.sort()).toEqual([...SECRET_NAMES].sort());
    for (const job of Object.values(jobs())) {
      const header = job.slice(0, job.indexOf("    steps:"));
      expect(header).not.toContain("secrets.");
    }
  });

  it("the secret-key secret is read by the three script steps only, as an env value", () => {
    const refs = [
      ...workflow.matchAll(/^\s+([A-Z_]+): \$\{\{ secrets\.SUPABASE_SECRET_KEY \}\}$/gm),
    ];
    expect(refs.map((m) => m[1])).toEqual([
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SECRET_KEY",
    ]);
  });
});

describe("platform-ops workflow: inputs and printing (plan 3.13 and the lead's rule of 2026-11-15)", () => {
  it("input names never match mail|email|password|secret|key|name", () => {
    const names = inputNames();
    expect(names.sort()).toEqual(
      ["actor", "conferma_disconnessione", "mode", "operation", "tenant", "user"].sort(),
    );
    for (const name of names) expect(name).not.toMatch(/mail|email|password|secret|key|name/i);
  });

  it("conferma_disconnessione is a required boolean whose description is the confirm text, word for word", () => {
    const block = onBlock().slice(onBlock().indexOf("conferma_disconnessione:"));
    expect(block).toMatch(/type: boolean/);
    expect(block).toMatch(/required: true/);
    expect(block).toContain(MFA_RESET_CONFIRM_TEXT);
  });

  it("the confirm text in the workflow is the one the script prompts", () => {
    expect(MFA_RESET_CONFIRM_TEXT).toBe(
      "La persona verrà disconnessa da tutti i locali in cui ha un accesso (e dalla console, se è l'account DigiAlto) e al prossimo accesso dovrà attivare di nuovo il codice.",
    );
  });

  it("no ${{ }} expression of any kind inside a run: step (inputs and secrets reach the shell only as env)", () => {
    for (const [name, job] of Object.entries(jobs()))
      for (const run of runBlocks(job)) expect(run, name).not.toContain("${{");
  });

  it("no echo of an inputs.* or secrets.* expression anywhere", () => {
    expect(workflow).not.toMatch(
      /(echo|printf)[^\n]*\$\{\{\s*(inputs|secrets|github\.event\.inputs)\./,
    );
  });

  it("no set -x, no xtrace, no debug trace", () => {
    expect(workflow).not.toMatch(/set\s+-[a-z]*x|xtrace|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG/);
  });

  it("a run: line that prints a variable taken from an input is preceded, in the same step, by ::add-mask:: for that variable", () => {
    // Variables whose env value is an input: `NAME: ${{ inputs.x }}`.
    const fromInputs = [
      ...workflow.matchAll(/^\s+([A-Z][A-Z0-9_]*): \$\{\{ inputs\.[a-z_]+ \}\}$/gm),
    ].map((m) => m[1] ?? "");
    expect(fromInputs.length).toBeGreaterThan(0);
    let printed = 0;
    for (const [name, job] of Object.entries(jobs())) {
      for (const run of runBlocks(job)) {
        const lines = run.split("\n");
        lines.forEach((line, index) => {
          if (!/\b(echo|printf)\b/.test(line) || line.includes("::add-mask::")) return;
          for (const variable of fromInputs) {
            if (!new RegExp(`\\$\\{?${variable}\\b`).test(line)) continue;
            printed += 1;
            const before = lines.slice(0, index).join("\n");
            expect(before, `${name}: ${line.trim()}`).toMatch(
              new RegExp(`::add-mask::\\$\\{?${variable}\\}?`),
            );
            // Only the first 8 characters of an id are shown.
            expect(line, `${name}: ${line.trim()}`).toMatch(new RegExp(`\\$\\{${variable}:0:8\\}`));
          }
        });
      }
    }
    expect(printed).toBeGreaterThan(0);
  });

  it("no run: line prints a secret variable", () => {
    const secretVars = [...workflow.matchAll(/^\s+([A-Z][A-Z0-9_]*): \$\{\{ secrets\./gm)].map(
      (m) => m[1] ?? "",
    );
    expect(secretVars.length).toBeGreaterThan(0);
    for (const [name, job] of Object.entries(jobs()))
      for (const run of runBlocks(job))
        for (const line of run.split("\n"))
          for (const variable of secretVars)
            if (/\b(echo|printf|cat|env|printenv)\b/.test(line))
              expect(line, name).not.toMatch(new RegExp(`\\$\\{?${variable}\\b`));
  });

  it("no input carries a name, an address or a VAT number: tenant and owner data are environment secrets", () => {
    expect(inputNames()).not.toEqual(expect.arrayContaining(["vat", "tenant_name", "owner"]));
    const create = jobs()["create-tenant"] ?? "";
    for (const secret of ["TENANT_NAME", "TENANT_VAT_NUMBER", "OWNER_EMAIL", "OWNER_NAME"])
      expect(create).toContain(`secrets.${secret}`);
    expect(create.match(/inputs\.[a-z_]+/g)).toEqual(["inputs.operation"]);
  });
});

describe("platform-ops workflow: the jobs", () => {
  it("the summary job writes the confirm text, short ids and no more, and fails an unticked mfa-reset", () => {
    const summary = jobs().summary ?? "";
    expect(summary).toContain(MFA_RESET_CONFIRM_TEXT);
    expect(summary).toContain("GITHUB_STEP_SUMMARY");
    expect(summary).toMatch(/\$\{USER_ID:0:8\}/);
    expect(summary).toMatch(/\$\{ACTOR_ID:0:8\}/);
    expect(summary).toMatch(/\$\{TENANT_ID:0:8\}/);
    expect(summary).toMatch(/exit 1/);
  });

  it("mfa-reset runs only for its operation and only when the confirmation is ticked, and passes --yes", () => {
    const job = jobs()["mfa-reset"] ?? "";
    expect(job).toMatch(
      /if: .*inputs\.operation == 'mfa-reset'.*inputs\.conferma_disconnessione == true/s,
    );
    expect(job).toContain("scripts/mfa-reset.ts");
    expect(job).toContain('--user "$USER_ID"');
    expect(job).toContain('--actor "$ACTOR_ID"');
    expect(job).toMatch(/--yes/);
    for (const other of ["set-mfa-enforcement", "create-tenant"])
      expect(jobs()[other] ?? "", other).not.toContain("--yes");
  });

  it("set-mfa-enforcement runs the script with the tenant, the mode and the actor", () => {
    const job = jobs()["set-mfa-enforcement"] ?? "";
    expect(job).toContain("inputs.operation == 'set-mfa-enforcement'");
    expect(job).toContain("scripts/set-mfa-enforcement.ts");
    expect(job).toContain('--tenant "$TENANT_ID"');
    expect(job).toContain('--mode "$MODE"');
    expect(job).toContain('--actor "$ACTOR_ID"');
  });

  it("create-tenant runs the script with the secrets as env variables", () => {
    const job = jobs()["create-tenant"] ?? "";
    expect(job).toContain("inputs.operation == 'create-tenant'");
    expect(job).toContain("scripts/create-tenant.ts");
    expect(job).toContain('--vat "$TENANT_VAT_NUMBER"');
  });

  it("runs the scripts with npx tsx, not npm run (npm would print the arguments)", () => {
    for (const name of SECRET_JOBS) {
      const runs = runBlocks(jobs()[name] ?? "").join("\n");
      expect(runs, name).toContain("npx tsx scripts/");
      expect(runs, name).not.toMatch(/npm run (create-tenant|mfa-reset)/);
    }
  });

  it("each script job installs with npm ci and has a timeout", () => {
    for (const name of SECRET_JOBS) {
      const job = jobs()[name] ?? "";
      expect(job, name).toContain("npm ci");
      expect(job, name).toMatch(/timeout-minutes: \d+/);
    }
  });
});
