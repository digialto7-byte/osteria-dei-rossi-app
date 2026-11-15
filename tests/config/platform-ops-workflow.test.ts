import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MFA_RESET_CONFIRM_TEXT } from "../../scripts/lib/mfa-admin";

// SP3 step 6 (plan sections 3.9.3 and 3.13) and its review. Every secret-key script runs as a job of one manual workflow in the protected environment
// `platform-ops`, approved by the founder. The repository is public, so the run log and the inputs are readable by anyone.
//   - GitHub prints a step's `env:` block, values included, in the step's log header BEFORE the step runs, so no input value may be in any `env:` (or any other
//     `${{ }}` outside an `if:`). Each job's first step reads the inputs from $GITHUB_EVENT_PATH, validates them, masks ids and only then exports them.
//   - A mask applies only inside the job that registers it, so every job registers its own.
//   - Every line of every `run:` is on an allowlist: structural shell, the read helpers, `::add-mask::`, exports to $GITHUB_ENV, fixed literals, the 8-character
//     prefix of an id, and the script invocations. A line that prints in any other way (echo of a variable, printf, cat, tee, printenv, a heredoc, an alias) fails.
// The YAML is read as text (no YAML parser is a dependency). Each rule is proved on a mutated copy of the workflow below.
const path = new URL("../../.github/workflows/platform-ops.yml", import.meta.url);
const workflow = existsSync(path) ? readFileSync(path, "utf8") : "";

/** Secret names of the environment (plan 9a FS-1, plus the four tenant-creation values the lead moved from inputs to secrets on 2026-11-15). */
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
const INPUT_NAMES = ["actor", "conferma_disconnessione", "mode", "operation", "tenant", "user"];
const BANNED_INPUT_NAME = /mail|email|password|secret|key|name/i;

// ---- reading the YAML as text ----

/** The text of each job, by name: from its two-space-indented key to the next one. */
function jobsOf(text: string): Record<string, string> {
  const body = text.slice(text.search(/^jobs:$/m));
  const parts = body.split(/\n(?= {2}[a-z][a-z0-9-]*:\s*$)/m).slice(1);
  return Object.fromEntries(parts.map((part) => [part.trim().split(":")[0] ?? "", part]));
}

/** The `on:` block: from `on:` to the next top-level key. */
function onBlockOf(text: string): string {
  const start = text.search(/^on:$/m);
  const rest = text.slice(start + 3);
  const end = rest.search(/^\S/m);
  return rest.slice(0, end === -1 ? undefined : end);
}

/** Names of the workflow_dispatch inputs: every YAML key at the input level, whatever characters it holds (hyphens and digits included). */
function inputNamesOf(text: string): string[] {
  const block = onBlockOf(text);
  const inputs = block.slice(block.search(/^ {4}inputs:\s*$/m));
  return [...inputs.matchAll(/^ {6}([^\s:#][^:]*):\s*$/gm)].map((m) => (m[1] ?? "").trim());
}

/** The shell text of every `run:` step in a job (inline or block). */
function runBlocksOf(job: string): string[] {
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
      block.push(line.slice(indent + 2));
    }
    out.push(block.join("\n"));
  }
  return out;
}

/** The steps of a job, each as its text. */
function stepsOf(job: string): string[] {
  return job
    .slice(job.indexOf("    steps:") + "    steps:".length)
    .split(/\n(?= {6}- )/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- the allowlist of what a run: line may be ----

const UUID_RE = String.raw`\\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\z`;
const READ_UUID_DEF = `read_uuid() { jq -er --arg k "$1" '(.inputs[$k] // "") | select(test("${UUID_RE}"))' "$GITHUB_EVENT_PATH"; }`;
const READ_CHOICE_DEF = `read_choice() { jq -er --arg k "$1" --arg allowed "$2" '(.inputs[$k] // "") as $v | $v | select(($allowed | split(" ")) | index($v))' "$GITHUB_EVENT_PATH"; }`;
const READ_BOOL_DEF = `read_bool() { jq -er --arg k "$1" '(.inputs[$k] // "false") | tostring | select(. == "true" or . == "false")' "$GITHUB_EVENT_PATH"; }`;
const EXACT_LINES = new Set([
  "set -eu",
  "esac",
  ";;",
  "fi",
  "else",
  "{",
  '} >> "$GITHUB_STEP_SUMMARY"',
  "npm ci",
  READ_UUID_DEF,
  READ_CHOICE_DEF,
  READ_BOOL_DEF,
]);
const FAIL = String.raw`\|\| \{ echo "::error::[^$\`"\\]*"; exit 1; \}`;
const LITERAL = String.raw`[^$\`"\\]*`; // a fixed text: no expansion, no quote, no backslash
const SUMMARY = String.raw`(?: >> "\$GITHUB_STEP_SUMMARY")?`;
const PREFIX_TEXT = String.raw`(?:[^$\`"\\]|\$\{[A-Z][A-Z0-9_]*:0:8\})*`; // fixed text and ${NAME:0:8} only
const LINE_RULES: [string, RegExp][] = [
  ["a comment or blank", /^(#.*)?$/],
  ["a uuid read", new RegExp(String.raw`^([a-z_]+)=\$\(read_uuid [a-z_]+\) ${FAIL}$`)],
  [
    "a choice read",
    new RegExp(String.raw`^([a-z_]+)=\$\(read_choice [a-z_]+ "[a-z -]+"\) ${FAIL}$`),
  ],
  ["a bool read", new RegExp(String.raw`^([a-z_]+)=\$\(read_bool [a-z_]+\) ${FAIL}$`)],
  ["a mask", /^echo "::add-mask::\$([a-z_]+)"$/],
  ["an export to GITHUB_ENV", /^echo "([A-Z][A-Z0-9_]*)=\$([a-z_]+)" >> "\$GITHUB_ENV"$/],
  ["a fixed echo", new RegExp(String.raw`^(?:[a-z-]+\) )?echo "${LITERAL}"${SUMMARY}(?: ;;)?$`)],
  [
    "an echo of fixed text and 8-character prefixes",
    new RegExp(String.raw`^echo "${PREFIX_TEXT}"${SUMMARY}$`),
  ],
  ["a case", /^case "\$[A-Za-z][A-Za-z0-9_]*" in$/],
  ["a case pattern", /^[a-z-]+(\|[a-z-]+)*\)$/],
  [
    "a comparison",
    /^(?:if|elif) \[ "\$[A-Za-z][A-Za-z0-9_]*" (?:=|!=) "[a-z-]+" \](?: (?:&&|\|\|) \[ "\$[A-Za-z][A-Za-z0-9_]*" (?:=|!=) "[a-z-]+" \])*; then$/,
  ],
  ["an exit", /^exit 1$/],
  ["a script call", /^npx tsx scripts\/[a-z-]+\.ts(?: --[a-z]+(?: "\$[A-Z][A-Z0-9_]*")?)*$/],
];

interface Finding {
  where: string;
  problem: string;
}

/** Every rule that needs no execution, applied to a workflow text. An empty list is a clean workflow. */
function violations(text: string): Finding[] {
  const found: Finding[] = [];
  // 1. No input value in an env: block, nor in any ${{ }} outside an `if:` (github.event.inputs and a whole-event dump included).
  text.split("\n").forEach((line, index) => {
    if (/^\s*(?:- )?if:/.test(line)) return;
    if (/\$\{\{[^}]*\b(inputs|github\.event)\b/.test(line))
      found.push({
        where: `line ${index + 1}`,
        problem: `input value in an expression: ${line.trim()}`,
      });
  });
  if (/^\s*run-name:/m.test(text))
    found.push({ where: "workflow", problem: "run-name can show an input" });
  // 2. Input names: every YAML key, hyphens and digits included, is on the exact list and none matches the ban.
  const names = inputNamesOf(text);
  for (const name of names)
    if (BANNED_INPUT_NAME.test(name))
      found.push({ where: `input ${name}`, problem: "banned input name" });
  if ([...names].sort().join(",") !== INPUT_NAMES.join(","))
    found.push({ where: "inputs", problem: `input names are ${names.join(",")}` });
  // 3. Every job reads its inputs first, from $GITHUB_EVENT_PATH, before anything else.
  for (const [name, job] of Object.entries(jobsOf(text))) {
    const first = stepsOf(job)[0] ?? "";
    if (!first.includes("$GITHUB_EVENT_PATH") || !/name: Read the inputs/.test(first))
      found.push({
        where: `job ${name}`,
        problem: "the first step does not read the inputs from GITHUB_EVENT_PATH",
      });
    // 4. The allowlist, line by line, over every run: block of the job.
    for (const run of runBlocksOf(job)) {
      const lines = run.split("\n").map((l) => l.trim());
      const uuidVars = new Set<string>();
      const assigned = new Set<string>();
      const masked = new Set<string>();
      lines.forEach((line) => {
        const rule =
          LINE_RULES.find(([, re]) => re.test(line)) ??
          (EXACT_LINES.has(line) ? ["exact", /./] : undefined);
        if (!rule) {
          found.push({ where: `job ${name}`, problem: `line not on the allowlist: ${line}` });
          return;
        }
        let m: RegExpExecArray | null;
        if ((m = /^([a-z_]+)=\$\(read_(uuid|choice|bool) /.exec(line))) {
          assigned.add(m[1] ?? "");
          if (m[2] === "uuid") uuidVars.add(m[1] ?? "");
        }
        if ((m = /^echo "::add-mask::\$([a-z_]+)"$/.exec(line))) {
          if (!uuidVars.has(m[1] ?? ""))
            found.push({
              where: `job ${name}`,
              problem: `mask of a variable that is not a read uuid: ${line}`,
            });
          masked.add(m[1] ?? "");
        }
        if ((m = /^echo "[A-Z][A-Z0-9_]*=\$([a-z_]+)" >> "\$GITHUB_ENV"$/.exec(line))) {
          if (!assigned.has(m[1] ?? ""))
            found.push({
              where: `job ${name}`,
              problem: `export of a variable the step did not read: ${line}`,
            });
          if (uuidVars.has(m[1] ?? "") && !masked.has(m[1] ?? ""))
            found.push({
              where: `job ${name}`,
              problem: `an id is exported before it is masked: ${line}`,
            });
        }
      });
    }
  }
  return found;
}

/** Applies a change to the real workflow text and asserts the change was made. */
function mutate(change: (text: string) => string): string {
  const changed = change(workflow);
  expect(changed).not.toBe(workflow);
  return changed;
}

// ---- tests ----

describe("platform-ops workflow", () => {
  it("exists", () => {
    expect(workflow).not.toBe("");
  });

  it("is started by hand only: no push, pull request, schedule or other trigger", () => {
    const on = onBlockOf(workflow);
    expect(on).toMatch(/^\s+workflow_dispatch:/m);
    expect(on.match(/^ {2}[a-z_]+:/gm)).toEqual(["  workflow_dispatch:"]);
    expect(workflow).not.toMatch(
      /^\s*(push|pull_request|pull_request_target|schedule|workflow_run|workflow_call|repository_dispatch):/m,
    );
  });

  it("has the jobs summary, mfa-reset, set-mfa-enforcement and create-tenant, and no other", () => {
    expect(Object.keys(jobsOf(workflow)).sort()).toEqual([...SECRET_JOBS, "summary"].sort());
  });

  it("pins the runner image (ci-runner-image rule), a read-only token and no persisted credentials", () => {
    const runners = [...workflow.matchAll(/runs-on: (.+)/g)].map((m) => m[1]);
    expect(runners).toHaveLength(4);
    expect(new Set(runners)).toEqual(new Set(["ubuntu-24.04"]));
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(3);
  });

  it("every job runs only from main", () => {
    for (const [name, job] of Object.entries(jobsOf(workflow)))
      expect(job, name).toContain("github.ref == 'refs/heads/main'");
  });
});

describe("platform-ops workflow: approval (plan 3.13)", () => {
  it("the summary job has no environment, no secret and no token permission at all", () => {
    const summary = jobsOf(workflow).summary ?? "";
    expect(summary).not.toMatch(/^\s+environment:/m);
    expect(summary).not.toContain("secrets.");
    expect(summary).toMatch(/^ {4}permissions: \{\}$/m);
  });

  it("every job that reads a secrets.* value has environment platform-ops and needs the summary job", () => {
    const withSecrets = Object.entries(jobsOf(workflow)).filter(([, job]) =>
      /\$\{\{\s*secrets\./.test(job),
    );
    expect(withSecrets.map(([name]) => name).sort()).toEqual([...SECRET_JOBS].sort());
    for (const [name, job] of withSecrets) {
      expect(job, name).toMatch(/^ {4}environment: platform-ops$/m);
      expect(job, name).toMatch(/^ {4}needs: summary$/m);
    }
  });

  it("platform-ops is the only environment ever named, once per secret job", () => {
    expect([...workflow.matchAll(/environment:\s*(\S+)/g)].map((m) => m[1])).toEqual([
      "platform-ops",
      "platform-ops",
      "platform-ops",
    ]);
  });

  it("reads exactly the secret names of the environment, never at job level", () => {
    const used = [...new Set([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
    expect(used.sort()).toEqual([...SECRET_NAMES].sort());
    for (const job of Object.values(jobsOf(workflow)))
      expect(job.slice(0, job.indexOf("    steps:"))).not.toContain("secrets.");
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

  it("no run: line prints a secret variable, and no step prints the environment", () => {
    for (const run of Object.values(jobsOf(workflow)).flatMap(runBlocksOf))
      expect(run).not.toMatch(/\b(printenv|env|set)\b\s*($|\||>)|\bdeclare\b|export -p/m);
  });
});

describe("platform-ops workflow: nothing an input holds reaches a log (the review's blocker)", () => {
  it("the real workflow has no violation", () => {
    expect(violations(workflow)).toEqual([]);
  });

  it("input names are the exact list and never match mail|email|password|secret|key|name", () => {
    expect(inputNamesOf(workflow).sort()).toEqual(INPUT_NAMES);
    for (const name of inputNamesOf(workflow)) expect(name).not.toMatch(BANNED_INPUT_NAME);
  });

  it("proof: the old pattern (an input as a step env value) is caught", () => {
    const bad = mutate((t) =>
      t.replace(
        "        run: npx tsx scripts/mfa-reset.ts",
        "        env:\n          USER_ID: ${{ inputs.user }}\n        run: npx tsx scripts/mfa-reset.ts",
      ),
    );
    expect(
      violations(bad)
        .map((f) => f.problem)
        .join("\n"),
    ).toMatch(/input value in an expression/);
  });

  it("proof: github.event.inputs in an env value is caught", () => {
    const bad = mutate((t) =>
      t.replace(
        "      - run: npm ci",
        "      - env:\n          USER_ID: ${{ github.event.inputs.user }}\n        run: npm ci",
      ),
    );
    expect(
      violations(bad)
        .map((f) => f.problem)
        .join("\n"),
    ).toMatch(/input value in an expression/);
  });

  it("proof: a hyphenated input name that matches the ban is caught (hyphens and digits are part of the name)", () => {
    const bad = mutate((t) =>
      t.replace(
        "      user:\n",
        "      my-secret-2:\n        description: x\n        type: string\n      user:\n",
      ),
    );
    const problems = violations(bad)
      .map((f) => f.problem)
      .join("\n");
    expect(problems).toMatch(/banned input name/);
    expect(inputNamesOf(bad)).toContain("my-secret-2");
  });

  it("proof: a hyphenated input name that is not banned is still caught by the exact list", () => {
    const bad = mutate((t) =>
      t.replace(
        "      user:\n",
        "      extra-1:\n        description: x\n        type: string\n      user:\n",
      ),
    );
    expect(
      violations(bad)
        .map((f) => f.problem)
        .join("\n"),
    ).toMatch(/input names are/);
  });

  it("proof: printenv, cat, tee, a heredoc and an alias are caught by the allowlist", () => {
    for (const line of [
      "printenv USER_ID",
      "env",
      "cat <<EOF",
      'echo "$USER_ID" | tee /dev/stderr',
      'printf "%s" "$USER_ID"',
      'alias_id="$USER_ID"',
      'echo "$USER_ID"',
      'echo "${USER_ID}"',
      'echo "id ${USER_ID:0:9}"',
      'echo "$(cat "$GITHUB_EVENT_PATH")"',
    ]) {
      const bad = mutate((t) =>
        t.replace("          set -eu\n", `          set -eu\n          ${line}\n`),
      );
      expect(
        violations(bad)
          .map((f) => f.problem)
          .join("\n"),
        line,
      ).toContain("line not on the allowlist");
    }
  });

  it("proof: exporting an id before masking it is caught", () => {
    const bad = mutate((t) => t.replace(/ {10}echo "::add-mask::\$user"\n/, ""));
    expect(
      violations(bad)
        .map((f) => f.problem)
        .join("\n"),
    ).toMatch(/exported before it is masked/);
  });

  it("proof: a job whose first step is not the input read is caught", () => {
    const bad = mutate((t) => t.replace("name: Read the inputs", "name: Read something else"));
    expect(
      violations(bad)
        .map((f) => f.problem)
        .join("\n"),
    ).toMatch(/first step does not read the inputs/);
  });

  it("proof: run-name is caught", () => {
    const bad = mutate((t) =>
      t.replace("name: Platform ops", "name: Platform ops\nrun-name: Reset ${{ github.actor }}"),
    );
    expect(
      violations(bad)
        .map((f) => f.problem)
        .join("\n"),
    ).toMatch(/run-name/);
  });

  it("no ${{ }} of any kind inside a run: step, no set -x, no debug trace", () => {
    for (const run of Object.values(jobsOf(workflow)).flatMap(runBlocksOf))
      expect(run).not.toContain("${{");
    expect(workflow).not.toMatch(/set\s+-[a-z]*x|xtrace|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG/);
  });

  it("no input carries a name, an address or a VAT number: tenant and owner data are environment secrets", () => {
    const create = jobsOf(workflow)["create-tenant"] ?? "";
    for (const secret of ["TENANT_NAME", "TENANT_VAT_NUMBER", "OWNER_EMAIL", "OWNER_NAME"])
      expect(create).toContain(`secrets.${secret}`);
    expect(create.match(/inputs\.[a-z_]+/g)).toEqual(["inputs.operation"]);
  });

  it("every job's first step is the input read, and it comes before checkout and everything else", () => {
    for (const [name, job] of Object.entries(jobsOf(workflow))) {
      const steps = stepsOf(job);
      expect(steps[0], name).toContain("name: Read the inputs");
      expect(steps[0], name).toContain("$GITHUB_EVENT_PATH");
      expect(steps[0], name).not.toContain("env:");
    }
  });
});

/** Runs a job's first step (its real shell text) against a fake event, in a scratch folder, with the runner's files. */
function runReadStep(job: string, inputs: Record<string, unknown>) {
  const first = runBlocksOf(jobsOf(workflow)[job] ?? "")[0] ?? "";
  const dir = mkdtempSync(join(tmpdir(), "platform-ops-"));
  const event = join(dir, "event.json");
  const envFile = join(dir, "github_env");
  writeFileSync(event, JSON.stringify({ inputs }));
  writeFileSync(envFile, "");
  const result = spawnSync("bash", ["-e", "-c", first], {
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      GITHUB_EVENT_PATH: event,
      GITHUB_ENV: envFile,
      GITHUB_STEP_SUMMARY: join(dir, "summary"),
    },
    encoding: "utf8",
  });
  return {
    status: result.status,
    out: result.stdout + result.stderr,
    env: readFileSync(envFile, "utf8"),
  };
}

const USER = "ae100000-0000-4000-8000-0000000000ae";
const ACTOR = "ad100000-0000-4000-8000-0000000000ad";
const TENANT = "11111111-1111-4111-8111-111111111111";

describe("platform-ops workflow: the read step, executed against a fake event", () => {
  it("mfa-reset: masks each id before exporting it, exports it, and prints no id", () => {
    const r = runReadStep("mfa-reset", {
      operation: "mfa-reset",
      user: USER,
      actor: ACTOR,
      conferma_disconnessione: true,
    });
    expect(r.status).toBe(0);
    expect(r.env).toBe(`USER_ID=${USER}\nACTOR_ID=${ACTOR}\n`);
    expect(r.out).toContain(`::add-mask::${USER}`);
    expect(r.out).toContain(`::add-mask::${ACTOR}`);
    expect(r.out.indexOf(`::add-mask::${USER}`)).toBeGreaterThanOrEqual(0);
    // The only place an id appears on stdout is the mask command itself.
    expect(
      r.out.replaceAll(`::add-mask::${USER}`, "").replaceAll(`::add-mask::${ACTOR}`, ""),
    ).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("mfa-reset: refuses an unticked confirmation, an uppercase id, a multi-line id and a missing id, exporting nothing and echoing no input", () => {
    const cases: [string, Record<string, unknown>][] = [
      [
        "unticked",
        { operation: "mfa-reset", user: USER, actor: ACTOR, conferma_disconnessione: false },
      ],
      [
        "uppercase",
        {
          operation: "mfa-reset",
          user: USER.toUpperCase(),
          actor: ACTOR,
          conferma_disconnessione: true,
        },
      ],
      [
        "multi-line",
        {
          operation: "mfa-reset",
          user: `${USER}\nSECRET=1`,
          actor: ACTOR,
          conferma_disconnessione: true,
        },
      ],
      [
        "trailing newline",
        { operation: "mfa-reset", user: `${USER}\n`, actor: ACTOR, conferma_disconnessione: true },
      ],
      ["missing", { operation: "mfa-reset", actor: ACTOR, conferma_disconnessione: true }],
      [
        "not a uuid",
        { operation: "mfa-reset", user: "x", actor: ACTOR, conferma_disconnessione: true },
      ],
    ];
    for (const [label, inputs] of cases) {
      const r = runReadStep("mfa-reset", inputs);
      expect(r.status, label).not.toBe(0);
      expect(r.out, label).not.toContain("SECRET=1");
      // The mask command is the one place an id may be on stdout (the runner consumes it).
      expect(r.out.replaceAll(`::add-mask::${ACTOR}`, ""), label).not.toContain(ACTOR);
    }
    expect(runReadStep("mfa-reset", cases[1]![1]).env).toBe("");
  });

  it("set-mfa-enforcement: exports the tenant, the actor and a valid mode; refuses the sentinel and an unknown mode", () => {
    const ok = runReadStep("set-mfa-enforcement", {
      operation: "set-mfa-enforcement",
      tenant: TENANT,
      actor: ACTOR,
      mode: "required",
    });
    expect(ok.status).toBe(0);
    expect(ok.env).toBe(`TENANT_ID=${TENANT}\nACTOR_ID=${ACTOR}\nMODE=required\n`);
    for (const mode of ["scegli", "", "off required", "Required"]) {
      const r = runReadStep("set-mfa-enforcement", {
        operation: "set-mfa-enforcement",
        tenant: TENANT,
        actor: ACTOR,
        mode,
      });
      expect(r.status, mode).not.toBe(0);
    }
  });

  it("create-tenant: accepts only its own operation and exports nothing", () => {
    const ok = runReadStep("create-tenant", { operation: "create-tenant" });
    expect(ok.status).toBe(0);
    expect(ok.env).toBe("");
    expect(runReadStep("create-tenant", { operation: "mfa-reset" }).status).not.toBe(0);
  });

  it("summary: reads the operation and each field that operation needs; the mode has no default", () => {
    const reset = runReadStep("summary", {
      operation: "mfa-reset",
      user: USER,
      actor: ACTOR,
      conferma_disconnessione: false,
    });
    expect(reset.status).toBe(0);
    expect(reset.env).toContain("OPERATION=mfa-reset\n");
    expect(
      runReadStep("summary", {
        operation: "set-mfa-enforcement",
        tenant: TENANT,
        actor: ACTOR,
        mode: "scegli",
      }).status,
    ).not.toBe(0);
    expect(
      runReadStep("summary", { operation: "set-mfa-enforcement", tenant: TENANT, actor: ACTOR })
        .status,
    ).not.toBe(0);
    expect(runReadStep("summary", { operation: "nonsense" }).status).not.toBe(0);
  });
});

describe("platform-ops workflow: the inputs", () => {
  it("conferma_disconnessione is a required boolean whose description is the confirm text, word for word", () => {
    const block = onBlockOf(workflow).slice(
      onBlockOf(workflow).indexOf("conferma_disconnessione:"),
    );
    expect(block).toMatch(/type: boolean/);
    expect(block).toMatch(/required: true/);
    expect(block).toContain(MFA_RESET_CONFIRM_TEXT);
  });

  it("the confirm text is the one the plan gives (da approvare)", () => {
    expect(MFA_RESET_CONFIRM_TEXT).toBe(
      "La persona verrà disconnessa da tutti i locali in cui ha un accesso (e dalla console, se è l'account DigiAlto) e al prossimo accesso dovrà attivare di nuovo il codice.",
    );
  });

  it("mode has no default: it is a required choice that starts on a sentinel the workflow refuses", () => {
    const on = onBlockOf(workflow);
    const mode = on.slice(on.indexOf("      mode:"), on.indexOf("      conferma_disconnessione:"));
    expect(mode).toMatch(/required: true/);
    expect(mode).toMatch(/default: scegli/);
    expect(mode).toMatch(/- scegli\n\s+- "off"\n\s+- enrolled\n\s+- required/);
    // The sentinel is never in the list a read accepts.
    const read = runBlocksOf(jobsOf(workflow)["set-mfa-enforcement"] ?? "")[0] ?? "";
    expect(read).toContain('"off enrolled required"');
    expect(read).not.toContain("scegli");
  });
});

describe("platform-ops workflow: the jobs", () => {
  it("the summary job writes the confirm text, short ids, the secrets reminder and no more; its errors go to the log, not the summary", () => {
    const summary = jobsOf(workflow).summary ?? "";
    expect(summary).toContain(MFA_RESET_CONFIRM_TEXT);
    expect(summary).toContain("GITHUB_STEP_SUMMARY");
    expect(summary).toMatch(/\$\{USER_ID:0:8\}/);
    expect(summary).toMatch(/\$\{ACTOR_ID:0:8\}/);
    expect(summary).toMatch(/\$\{TENANT_ID:0:8\}/);
    expect(summary).toMatch(/exit 1/);
    for (const line of summary.split("\n").filter((l) => l.includes("::error::")))
      expect(line).not.toContain("GITHUB_STEP_SUMMARY");
    // create-tenant: delete the four secrets after the run.
    expect(summary).toMatch(
      /Dopo l'esecuzione elimina i quattro segreti: TENANT_NAME, TENANT_VAT_NUMBER, OWNER_EMAIL, OWNER_NAME/,
    );
  });

  it("mfa-reset runs only for its operation and only when the confirmation is ticked, and passes --yes", () => {
    const job = jobsOf(workflow)["mfa-reset"] ?? "";
    expect(job).toMatch(
      /if: .*inputs\.operation == 'mfa-reset'.*inputs\.conferma_disconnessione == true/s,
    );
    expect(job).toContain(
      'npx tsx scripts/mfa-reset.ts --user "$USER_ID" --actor "$ACTOR_ID" --yes',
    );
    for (const other of ["set-mfa-enforcement", "create-tenant"])
      expect(jobsOf(workflow)[other] ?? "", other).not.toContain("--yes");
  });

  it("set-mfa-enforcement runs the script with the tenant, the mode and the actor", () => {
    const job = jobsOf(workflow)["set-mfa-enforcement"] ?? "";
    expect(job).toContain("inputs.operation == 'set-mfa-enforcement'");
    expect(job).toContain(
      'npx tsx scripts/set-mfa-enforcement.ts --tenant "$TENANT_ID" --mode "$MODE" --actor "$ACTOR_ID"',
    );
  });

  it("create-tenant runs the script with no arguments: the data is in the environment", () => {
    const job = jobsOf(workflow)["create-tenant"] ?? "";
    expect(job).toContain("inputs.operation == 'create-tenant'");
    expect(job).toMatch(/run: npx tsx scripts\/create-tenant\.ts$/m);
    expect(job).not.toMatch(/--name|--vat|--owner/);
    expect(job).not.toContain("CREATE_TENANT_FULL_ID");
  });

  it("runs the scripts with npx tsx, not npm run (npm would print the arguments)", () => {
    for (const name of SECRET_JOBS) {
      const runs = runBlocksOf(jobsOf(workflow)[name] ?? "").join("\n");
      expect(runs, name).toContain("npx tsx scripts/");
      expect(runs, name).not.toMatch(/npm run (create-tenant|mfa-reset)/);
    }
  });

  it("each script job installs with npm ci and has a timeout", () => {
    for (const name of SECRET_JOBS) {
      const job = jobsOf(workflow)[name] ?? "";
      expect(job, name).toContain("npm ci");
      expect(job, name).toMatch(/timeout-minutes: \d+/);
    }
  });
});
