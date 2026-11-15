import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { MFA_RESET_CONFIRM_TEXT } from "../../scripts/lib/mfa-admin";

// SP3 step 6 (plan sections 3.9.3 and 3.13) and its two reviews. Every secret-key script runs as a job of one manual workflow in the protected environment
// `platform-ops`, approved by the founder. The repository is public, so the run log and the inputs are readable by anyone.
//
// This guard is an ALLOWLIST over the parsed workflow, not a search for bad words:
//   - the only `${{ }}` outside an `if:` is exactly `${{ secrets.<name> }}` as a step env value, with the variable name that secret is paired with;
//   - the only keys a workflow, job and step may hold are listed; `shell:`, `defaults:` and `run-name:` do not exist, nor does any trace option;
//   - `uses:` is exactly the two pinned actions, with their exact `with:`;
//   - every line of every `run:` is on a line allowlist; an 8-character prefix is printable only for the three ids, and only in the summary job;
//   - the job's first step reads the inputs from the event file and masks each id before exporting it; the secret jobs have a fixed step sequence.
// Each rule is proved on a copy of the PARSED workflow changed in one place (not by a search-and-replace on text), and the proof states which rules fire.
const path = new URL("../../.github/workflows/platform-ops.yml", import.meta.url);
const workflowText = readFileSync(path, "utf8"); // a missing file throws: there is no empty default

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };
const isObj = (value: Json | undefined): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const parse = (text: string): Obj => {
  const doc = load(text) as Json;
  if (!isObj(doc)) throw new Error("the workflow is not a mapping");
  return doc;
};
const doc: Obj = parse(workflowText);
const clone = (value: Obj): Obj => JSON.parse(JSON.stringify(value)) as Obj;

/** What GitHub's environment `platform-ops` holds (plan 9a FS-1) and the env variable each secret is paired with. */
const SECRET_PAIRS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "SUPABASE_URL",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "SUPABASE_PUBLISHABLE_KEY",
  SUPABASE_SECRET_KEY: "SUPABASE_SECRET_KEY",
  PLATFORM_ADMIN_EMAIL: "PLATFORM_ADMIN_EMAIL",
  TENANT_NAME: "TENANT_NAME",
  TENANT_VAT_NUMBER: "TENANT_VAT_NUMBER",
  OWNER_EMAIL: "OWNER_EMAIL",
  OWNER_NAME: "OWNER_NAME",
};
const SUPABASE_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
];
const TENANT_VARS = ["TENANT_NAME", "TENANT_VAT_NUMBER", "OWNER_EMAIL", "OWNER_NAME"];
const SECRET_JOBS = ["mfa-reset", "set-mfa-enforcement", "create-tenant"];
const INPUT_NAMES = ["actor", "conferma_disconnessione", "mode", "operation", "tenant", "user"];
const BANNED_INPUT_NAME = /mail|email|password|secret|key|name/i;
// Lead, after the line-by-line read: the one workflow that holds the service key uses actions pinned to full commit SHAs (the tag is a comment in the
// file), and setup-node restores no npm cache into a job that then gets the key.
const PINNED_USES: Record<string, Obj> = {
  "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09": { "persist-credentials": false },
  "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444": {
    "node-version-file": ".nvmrc",
    "package-manager-cache": false,
  },
};
/** Every `uses:` in the file names a full 40-hex commit SHA. */
const FULL_SHA_USES = /^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/;
const PREFIX_IDS = ["USER_ID", "ACTOR_ID", "TENANT_ID"];
/** What each job may export through GITHUB_ENV, and the shell variable each name is paired with. Nothing else, so BASH_ENV or NODE_OPTIONS cannot be set. */
const EXPORT_PAIRS: Record<string, string> = {
  OPERATION: "operation",
  USER_ID: "user",
  ACTOR_ID: "actor",
  CONFIRMED: "confirmed",
  TENANT_ID: "tenant",
  MODE: "mode",
};
const EXPORTS_BY_JOB: Record<string, string[]> = {
  summary: ["OPERATION", "USER_ID", "ACTOR_ID", "CONFIRMED", "TENANT_ID", "MODE"],
  "mfa-reset": ["USER_ID", "ACTOR_ID"],
  "set-mfa-enforcement": ["TENANT_ID", "ACTOR_ID", "MODE"],
  "create-tenant": [],
};
const EXPECTED_SCRIPTS: Record<string, string> = {
  "mfa-reset": 'npx tsx scripts/mfa-reset.ts --user "$USER_ID" --actor "$ACTOR_ID" --yes',
  "set-mfa-enforcement":
    'npx tsx scripts/set-mfa-enforcement.ts --tenant "$TENANT_ID" --mode "$MODE" --actor "$ACTOR_ID"',
  "create-tenant": "npx tsx scripts/create-tenant.ts",
};
/** The shape of each workflow_dispatch input: its attribute keys, its type, whether it is required, its default and its options (descriptions are free text). */
const EXPECTED_INPUTS: Record<
  string,
  { type: string; required: boolean; default?: string | boolean; options?: string[] }
> = {
  operation: {
    type: "choice",
    required: true,
    options: ["mfa-reset", "set-mfa-enforcement", "create-tenant"],
  },
  user: { type: "string", required: false },
  actor: { type: "string", required: false },
  tenant: { type: "string", required: false },
  mode: {
    type: "choice",
    required: true,
    default: "scegli",
    options: ["scegli", "off", "enrolled", "required"],
  },
  conferma_disconnessione: { type: "boolean", required: true, default: false },
};

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
  "npm ci --ignore-scripts",
  READ_UUID_DEF,
  READ_CHOICE_DEF,
  READ_BOOL_DEF,
]);
const FAIL = String.raw`\|\| \{ echo "::error::[^$\`"\\]*"; exit 1; \}`;
const LITERAL = String.raw`(?!::)[^$\`"\\]*`; // a fixed text: no expansion, no quote, no backslash, and never a line that starts a workflow command (::)
const SUMMARY = String.raw`(?: >> "\$GITHUB_STEP_SUMMARY")?`;
const PREFIX_VAR = `(?:${PREFIX_IDS.join("|")})`;
const PREFIX_TEXT = String.raw`(?!::)(?:[^$\`"\\]|\$\{${PREFIX_VAR}:0:8\})*`; // fixed text and the 8-character prefix of one of the three ids
const VAR = String.raw`\$[A-Za-z][A-Za-z0-9_]*`;
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
  ["a case", new RegExp(String.raw`^case "${VAR}" in$`)],
  ["a case pattern", /^[a-z-]+(\|[a-z-]+)*\)$/],
  [
    "a comparison",
    new RegExp(
      String.raw`^(?:if|elif) \[ "${VAR}" (?:=|!=) "[a-z-]+" \](?: (?:&&|\|\|) \[ "${VAR}" (?:=|!=) "[a-z-]+" \])*; then$`,
    ),
  ],
  ["an exit", /^exit 1$/],
  [
    "a script call",
    new RegExp(String.raw`^npx tsx scripts/[a-z-]+\.ts(?: --[a-z]+(?: "${VAR}")?)*$`),
  ],
];

// ---- the audit: every rule, over a parsed workflow ----

const TOP_KEYS = ["name", "on", "permissions", "concurrency", "env", "jobs"];
const JOB_KEYS = [
  "name",
  "needs",
  "if",
  "environment",
  "runs-on",
  "timeout-minutes",
  "permissions",
  "steps",
];
const STEP_KEYS = ["name", "run", "uses", "with", "env"];
const IF_FORM =
  /^github\.ref == 'refs\/heads\/main'(?: && inputs\.operation == '[a-z-]+')?(?: && inputs\.conferma_disconnessione == true)?$/;
const SECRET_EXPR = /^\$\{\{ secrets\.([A-Z_]+) \}\}$/;
const TRACE =
  /(?:^|[\s"'=])-[A-Za-z]*x[A-Za-z]*(?=$|[\s"'])|xtrace|BASH_XTRACEFD|SHELLOPTS|\bset\s+[-+]o\b|\bset\s+[-+](?!eu\b)/;

function strings(
  value: Json,
  out: { where: string; text: string }[] = [],
  where = "$",
): { where: string; text: string }[] {
  if (typeof value === "string") out.push({ where, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, out, `${where}[${i}]`));
  else if (isObj(value))
    for (const [k, v] of Object.entries(value)) {
      out.push({ where: `${where}.${k} (key)`, text: k });
      strings(v, out, `${where}.${k}`);
    }
  return out;
}

/** The rule ids that fire for a workflow. An empty list is a clean workflow. */
function audit(workflow: Obj): string[] {
  const fired = new Set<string>();
  const fire = (rule: string) => fired.add(rule);
  const jobs = isObj(workflow.jobs) ? workflow.jobs : {};

  // Keys.
  for (const key of Object.keys(workflow)) if (!TOP_KEYS.includes(key)) fire("top-key");
  const topEnv = workflow.env;
  if (!isObj(topEnv) || JSON.stringify(topEnv) !== JSON.stringify({ NEXT_TELEMETRY_DISABLED: "1" }))
    fire("workflow-env");
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: "read" }))
    fire("permissions");
  // Triggers: exactly workflow_dispatch.
  const on = workflow.on;
  if (!isObj(on) || Object.keys(on).join() !== "workflow_dispatch") fire("trigger");
  const dispatch = isObj(on) && isObj(on.workflow_dispatch) ? on.workflow_dispatch : {};
  // Input names: every key, hyphens and digits included.
  const inputNames = isObj(dispatch.inputs) ? Object.keys(dispatch.inputs) : [];
  if (inputNames.some((n) => BANNED_INPUT_NAME.test(n))) fire("input-name");
  if ([...inputNames].sort().join() !== INPUT_NAMES.join()) fire("input-name");
  for (const [name, expected] of Object.entries(EXPECTED_INPUTS)) {
    const input = isObj(dispatch.inputs) ? dispatch.inputs[name] : undefined;
    if (!isObj(input)) continue;
    const want = [
      "description",
      "type",
      "required",
      ...(expected.default !== undefined ? ["default"] : []),
      ...(expected.options ? ["options"] : []),
    ]
      .sort()
      .join();
    if (Object.keys(input).sort().join() !== want) fire("input-shape");
    if (input.type !== expected.type || input.required !== expected.required) fire("input-shape");
    if (input.default !== expected.default) fire("input-shape");
    if (JSON.stringify(input.options) !== JSON.stringify(expected.options)) fire("input-shape");
  }
  // Expressions: only `if:` forms and the paired secret references.
  for (const { where, text } of strings(workflow)) {
    if (TRACE.test(text)) fire("trace");
    // stop-commands and the echo toggle switch the runner's command handling off or print every command: refused wherever they would come from.
    // `##[` is the legacy form of any workflow command (`##[echo]on`, `##[add-mask]…`): no line of this file ever needs it.
    if (/::stop-commands::|::echo::|stop-commands|##\[/.test(text)) fire("command");
    if (text.includes("${{") && !where.includes(".env.")) fire("expression");
    if (text.includes("ids-out")) fire("ids-out");
  }
  for (const key of ["shell", "defaults", "run-name"]) {
    if (strings(workflow).some(({ where }) => where.endsWith(`.${key} (key)`))) fire("banned-key");
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    if (!isObj(job)) {
      fire("job-key");
      continue;
    }
    for (const key of Object.keys(job)) if (!JOB_KEYS.includes(key)) fire("job-key");
    if (typeof job.if !== "string" || !IF_FORM.test(job.if)) fire("if-form");
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const kinds: string[] = [];
    const secretVars: string[] = [];
    steps.forEach((step, index) => {
      if (!isObj(step)) {
        fire("step-key");
        return;
      }
      for (const key of Object.keys(step)) if (!STEP_KEYS.includes(key)) fire("step-key");
      const isScript = typeof step.run === "string" && /^npx tsx scripts\//m.test(step.run);
      // Only the script step may hold env (a dependency install script must never see a secret).
      if (step.env !== undefined && !isScript) fire("step-env");
      // Env: names and values.
      if (isObj(step.env))
        for (const [name, value] of Object.entries(step.env)) {
          const match = typeof value === "string" ? SECRET_EXPR.exec(value) : null;
          if (!match || SECRET_PAIRS[name] !== match[1]) fire("expression");
          else if (isScript) secretVars.push(name);
        }
      else if (step.env !== undefined) fire("expression");
      // uses.
      if (typeof step.uses === "string") {
        const pinned = PINNED_USES[step.uses];
        if (!pinned) fire("uses");
        else if (JSON.stringify(step.with ?? null) !== JSON.stringify(pinned)) fire("uses");
        kinds.push(`uses:${step.uses.split("@")[0]}`);
        if (step.run !== undefined || step.env !== undefined) fire("steps");
      } else if (typeof step.run === "string") {
        kinds.push(
          /^npx tsx scripts\//m.test(step.run)
            ? "run:script"
            : step.run.trim() === "npm ci --ignore-scripts"
              ? "run:npm-ci"
              : index === 0
                ? "read"
                : "run:other",
        );
        if (step.with !== undefined) fire("steps");
        runLines(step.run, jobName, fire);
      } else fire("steps");
      if (index === 0) {
        const firstOk =
          step.name === "Read the inputs" &&
          step.env === undefined &&
          step.uses === undefined &&
          typeof step.run === "string" &&
          step.run.includes("$GITHUB_EVENT_PATH");
        if (!firstOk) fire("first-step");
      }
    });
    // The script each secret job runs: exactly one, exactly this.
    if (SECRET_JOBS.includes(jobName)) {
      const scripts = steps.filter(
        (st) => isObj(st) && typeof st.run === "string" && /^npx tsx scripts\//m.test(st.run),
      );
      if (
        scripts.length !== 1 ||
        !isObj(scripts[0]) ||
        scripts[0].run !== EXPECTED_SCRIPTS[jobName]
      )
        fire("script");
    }
    if (job["runs-on"] !== "ubuntu-24.04") fire("runs-on");
    // The step sequence of each job.
    const expected =
      jobName === "summary"
        ? "read,run:other"
        : SECRET_JOBS.includes(jobName)
          ? "read,uses:actions/checkout,uses:actions/setup-node,run:npm-ci,run:script"
          : "?";
    if (kinds.join() !== expected) fire("steps");
    // Secrets: only the secret jobs, only the vars each job needs.
    const wanted =
      jobName === "create-tenant"
        ? [...SUPABASE_VARS, ...TENANT_VARS]
        : SECRET_JOBS.includes(jobName)
          ? SUPABASE_VARS
          : [];
    if ([...secretVars].sort().join() !== [...wanted].sort().join()) fire("job-secrets");
    if (SECRET_JOBS.includes(jobName)) {
      if (
        job.environment !== "platform-ops" ||
        job.needs !== "summary" ||
        job.permissions !== undefined
      )
        fire("job-approval");
    } else if (
      job.environment !== undefined ||
      job.needs !== undefined ||
      JSON.stringify(job.permissions) !== "{}"
    )
      fire("job-approval");
  }
  return [...fired].sort();
}

function runLines(run: string, jobName: string, fire: (rule: string) => void): void {
  const uuidVars = new Set<string>();
  const assigned = new Set<string>();
  const masked = new Set<string>();
  for (const raw of run.split("\n")) {
    const line = raw.trim();
    const ok = LINE_RULES.some(([, re]) => re.test(line)) || EXACT_LINES.has(line);
    if (!ok) {
      fire("line");
      continue;
    }
    if (jobName !== "summary" && new RegExp(String.raw`\$\{${PREFIX_VAR}:0:8\}`).test(line))
      fire("prefix");
    let m: RegExpExecArray | null;
    if ((m = /^([a-z_]+)=\$\(read_(uuid|choice|bool) /.exec(line))) {
      assigned.add(m[1] ?? "");
      if (m[2] === "uuid") uuidVars.add(m[1] ?? "");
    }
    if ((m = /^echo "::add-mask::\$([a-z_]+)"$/.exec(line))) {
      if (!uuidVars.has(m[1] ?? "")) fire("mask-order");
      masked.add(m[1] ?? "");
    }
    if ((m = /^echo "([A-Z][A-Z0-9_]*)=\$([a-z_]+)" >> "\$GITHUB_ENV"$/.exec(line))) {
      const [, name = "", variable = ""] = m;
      if (!(EXPORTS_BY_JOB[jobName] ?? []).includes(name) || EXPORT_PAIRS[name] !== variable)
        fire("export-name");
      if (!assigned.has(variable)) fire("mask-order");
      if (uuidVars.has(variable) && !masked.has(variable)) fire("mask-order");
    }
  }
}

// ---- helpers for tests ----

const jobOf = (workflow: Obj, name: string): Obj => {
  const job = (workflow.jobs as Obj)[name];
  if (!isObj(job)) throw new Error(`no job ${name}`);
  return job;
};
const stepsOfJob = (workflow: Obj, name: string): Obj[] =>
  (jobOf(workflow, name).steps as Json[]).filter(isObj);
const runOf = (workflow: Obj, job: string, index: number): string => {
  const run = stepsOfJob(workflow, job)[index]?.run;
  if (typeof run !== "string") throw new Error(`no run in ${job}[${index}]`);
  return run;
};

/** A copy of the parsed workflow changed by `change`; the rules that fire for it. The real workflow fires none, so these are the change's own. */
function firedBy(change: (copy: Obj) => void): string[] {
  const copy = clone(doc);
  change(copy);
  expect(JSON.stringify(copy)).not.toBe(JSON.stringify(doc));
  return audit(copy);
}

// ---- tests ----

describe("platform-ops workflow: the audit passes the real file and fails every mutation, each for its own rule", () => {
  it("the real workflow fires no rule", () => {
    expect(workflowText).not.toBe("");
    expect(audit(doc)).toEqual([]);
  });

  it("the audit is not vacuous: it reads four jobs, their steps and the inputs", () => {
    expect(Object.keys(doc.jobs as Obj)).toEqual(["summary", ...SECRET_JOBS]);
    expect(stepsOfJob(doc, "mfa-reset")).toHaveLength(5);
    expect(stepsOfJob(doc, "summary")).toHaveLength(2);
    expect(Object.keys(((doc.on as Obj).workflow_dispatch as Obj).inputs as Obj).sort()).toEqual(
      INPUT_NAMES,
    );
  });

  const addStepEnv = (job: string, name: string, value: string) => (w: Obj) => {
    const steps = stepsOfJob(w, job);
    const last = steps[steps.length - 1] as Obj;
    last.env = { ...(last.env as Obj), [name]: value };
  };

  const appendRun = (job: string, index: number, line: string) => (w: Obj) => {
    stepsOfJob(w, job)[index]!.run = `${runOf(w, job, index).replace(/\n$/, "")}\n${line}\n`;
  };
  const replaceRun = (job: string, index: number, from: string, to: string) => (w: Obj) => {
    const run = runOf(w, job, index);
    expect(run).toContain(from);
    stepsOfJob(w, job)[index]!.run = run.replace(from, to);
  };
  const inputsOf = (w: Obj): Obj => ((w.on as Obj).workflow_dispatch as Obj).inputs as Obj;
  /** Moves every secret of a job's script step onto another step of the same job (the script step keeps none of them: the secret key moves, the rest stay). */
  const moveSecret = (job: string, from: number, to: number) => (w: Obj) => {
    const steps = stepsOfJob(w, job);
    const env = steps[from]!.env as Obj;
    steps[to]!.env = { SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY as Json };
    delete env.SUPABASE_SECRET_KEY;
  };

  const mutations: [string, (w: Obj) => void, string[]][] = [
    // Item A, the reviewer's four.
    [
      "a step env CTX: toJSON(github)",
      addStepEnv("mfa-reset", "CTX", "${{ toJSON(github) }}"),
      ["expression"],
    ],
    [
      "a step env CTX: ${{ github }}",
      addStepEnv("mfa-reset", "CTX", "${{ github }}"),
      ["expression"],
    ],
    [
      "a step env USER_ID: inputs.user (the first blocker)",
      addStepEnv("mfa-reset", "USER_ID", "${{ inputs.user }}"),
      ["expression"],
    ],
    [
      "a step env from github.event.inputs",
      addStepEnv("mfa-reset", "USER_ID", "${{ github.event.inputs.user }}"),
      ["expression"],
    ],
    [
      "a secret under another name",
      addStepEnv("mfa-reset", "SUPABASE_SECRET_KEY", "${{ secrets.OWNER_EMAIL }}"),
      ["expression", "job-secrets"],
    ],
    [
      "an expression in a step name",
      (w) => void (stepsOfJob(w, "mfa-reset")[4]!.name = "x ${{ inputs.user }}"),
      ["expression"],
    ],
    [
      "an expression in run-name",
      (w) => void (w["run-name"] = "x ${{ inputs.user }}"),
      ["banned-key", "expression", "top-key"],
    ],
    [
      "an expression in concurrency",
      (w) => void ((w.concurrency as Obj).group = "${{ inputs.user }}"),
      ["expression"],
    ],
    [
      "an expression in with:",
      (w) => void ((stepsOfJob(w, "mfa-reset")[2]!.with as Obj).cache = "${{ inputs.user }}"),
      ["expression", "uses"],
    ],
    [
      "shell: bash -x {0} on a step",
      (w) => void (stepsOfJob(w, "mfa-reset")[0]!.shell = "bash -x {0}"),
      ["banned-key", "step-key", "trace"],
    ],
    [
      "a workflow defaults.run.shell: bash -x {0}",
      (w) => void (w.defaults = { run: { shell: "bash -x {0}" } }),
      ["banned-key", "top-key", "trace"],
    ],
    [
      "a plain shell: bash on a step",
      (w) => void (stepsOfJob(w, "mfa-reset")[0]!.shell = "bash"),
      ["banned-key", "step-key"],
    ],
    [
      "set -x as a run line",
      (w) => void (stepsOfJob(w, "summary")[0]!.run = `set -x\n${runOf(w, "summary", 0)}`),
      ["line", "trace"],
    ],
    [
      "set -o xtrace as a run line",
      (w) => void (stepsOfJob(w, "summary")[0]!.run = `set -o xtrace\n${runOf(w, "summary", 0)}`),
      ["line", "trace"],
    ],
    [
      "BASH_XTRACEFD in a step env",
      addStepEnv("mfa-reset", "BASH_XTRACEFD", "2"),
      ["expression", "trace"],
    ],
    [
      "SHELLOPTS in the workflow env",
      (w) => void ((w.env as Obj).SHELLOPTS = "xtrace"),
      ["trace", "workflow-env"],
    ],
    [
      "the first 8 characters of a secret (env OWNER_EMAIL, echo ${OWNER_EMAIL:0:8})",
      (w) => {
        addStepEnv("mfa-reset", "OWNER_EMAIL", "${{ secrets.OWNER_EMAIL }}")(w);
        const steps = stepsOfJob(w, "mfa-reset");
        steps[4]!.run = `echo "\${OWNER_EMAIL:0:8}"\n${steps[4]!.run}`;
      },
      ["job-secrets", "line", "script"],
    ],
    [
      "an 8-character prefix of an allowed id outside the summary job",
      (w) =>
        void (stepsOfJob(w, "mfa-reset")[4]!.run =
          `echo "id \${USER_ID:0:8}"\n${runOf(w, "mfa-reset", 4)}`),
      ["prefix", "script"],
    ],
    [
      "an extra uses: someone/dump-event@v1",
      (w) =>
        void (jobOf(w, "mfa-reset").steps as Json[]).splice(1, 0, {
          uses: "someone/dump-event@v1",
        }),
      ["steps", "uses"],
    ],
    [
      "checkout at an unpinned ref",
      (w) => void (stepsOfJob(w, "mfa-reset")[1]!.uses = "actions/checkout@main"),
      ["uses"],
    ],
    [
      "checkout at its v5 tag instead of a commit SHA",
      (w) => void (stepsOfJob(w, "mfa-reset")[1]!.uses = "actions/checkout@v5"),
      ["uses"],
    ],
    [
      "setup-node at a short SHA",
      (w) => void (stepsOfJob(w, "create-tenant")[2]!.uses = "actions/setup-node@a0853c2"),
      ["uses"],
    ],
    [
      "the npm cache restored into a secret job",
      (w) => void ((stepsOfJob(w, "set-mfa-enforcement")[2]!.with as Obj).cache = "npm"),
      ["uses"],
    ],
    [
      "npm ci without --ignore-scripts",
      (w) => void (stepsOfJob(w, "mfa-reset")[3]!.run = "npm ci"),
      ["line", "steps"],
    ],
    [
      "checkout without persist-credentials: false",
      (w) => void (stepsOfJob(w, "mfa-reset")[1]!.with = {}),
      ["uses"],
    ],
    // Item A addition: the triggers.
    ["a push trigger", (w) => void ((w.on as Obj).push = { branches: ["main"] }), ["trigger"]],
    [
      "a pull_request trigger",
      (w) => void ((w.on as Obj).pull_request = { branches: ["main"] }),
      ["trigger"],
    ],
    [
      "a schedule trigger",
      (w) => void ((w.on as Obj).schedule = [{ cron: "0 3 * * *" }]),
      ["trigger"],
    ],
    ["a workflow_call trigger", (w) => void ((w.on as Obj).workflow_call = {}), ["trigger"]],
    // The earlier rules.
    [
      "a hyphenated banned input name",
      (w) =>
        void ((((w.on as Obj).workflow_dispatch as Obj).inputs as Obj)["my-secret-2"] = {
          type: "string",
        }),
      ["input-name"],
    ],
    [
      "a hyphenated input name that is not banned",
      (w) =>
        void ((((w.on as Obj).workflow_dispatch as Obj).inputs as Obj)["extra-1"] = {
          type: "string",
        }),
      ["input-name"],
    ],
    [
      "platform-ops passing --ids-out",
      (w) =>
        void (stepsOfJob(w, "create-tenant")[4]!.run =
          "npx tsx scripts/create-tenant.ts --ids-out /tmp/x"),
      ["ids-out", "line", "script"],
    ],
    [
      "printenv in a run",
      (w) => void (stepsOfJob(w, "summary")[1]!.run = `printenv\n${runOf(w, "summary", 1)}`),
      ["line"],
    ],
    [
      "a heredoc in a run",
      (w) => void (stepsOfJob(w, "summary")[1]!.run = `cat <<EOF\n${runOf(w, "summary", 1)}`),
      ["line"],
    ],
    [
      "tee in a run",
      (w) =>
        void (stepsOfJob(w, "summary")[1]!.run =
          `echo "$USER_ID" | tee /dev/stderr\n${runOf(w, "summary", 1)}`),
      ["line"],
    ],
    [
      "an echo of a full id",
      (w) => void (stepsOfJob(w, "summary")[1]!.run = `echo "$USER_ID"\n${runOf(w, "summary", 1)}`),
      ["line"],
    ],
    [
      "a 9-character prefix",
      (w) =>
        void (stepsOfJob(w, "summary")[1]!.run =
          `echo "\${USER_ID:0:9}"\n${runOf(w, "summary", 1)}`),
      ["line"],
    ],
    [
      "an alias of an input variable",
      (w) =>
        void (stepsOfJob(w, "summary")[1]!.run = `alias_id="$USER_ID"\n${runOf(w, "summary", 1)}`),
      ["line"],
    ],
    [
      "an id exported before its mask",
      (w) =>
        void (stepsOfJob(w, "mfa-reset")[0]!.run = runOf(w, "mfa-reset", 0).replace(
          'echo "::add-mask::$user"\n',
          "",
        )),
      ["mask-order"],
    ],
    [
      "a first step that is not the input read",
      (w) => void (stepsOfJob(w, "mfa-reset")[0]!.name = "Read something else"),
      ["first-step"],
    ],
    [
      "an input in the first step's env",
      (w) => void (stepsOfJob(w, "mfa-reset")[0]!.env = { A: "${{ secrets.SUPABASE_URL }}" }),
      ["expression", "first-step", "step-env"],
    ],
    ["a job-level env", (w) => void (jobOf(w, "mfa-reset").env = { A: "1" }), ["job-key"]],
    [
      "a secret job without the environment",
      (w) => void delete jobOf(w, "mfa-reset").environment,
      ["job-approval"],
    ],
    [
      "a secret job that does not need the summary",
      (w) => void delete jobOf(w, "create-tenant").needs,
      ["job-approval"],
    ],
    [
      "a summary job with an environment",
      (w) => void (jobOf(w, "summary").environment = "platform-ops"),
      ["job-approval"],
    ],
    [
      "a summary job with token permissions",
      (w) => void (jobOf(w, "summary").permissions = { contents: "read" }),
      ["job-approval"],
    ],
    [
      "a job's if: that reads an unlisted expression",
      (w) => void (jobOf(w, "mfa-reset").if = "github.actor == 'x'"),
      ["if-form"],
    ],
    [
      "a job's if: wrapped in ${{ }}",
      (w) => void (jobOf(w, "mfa-reset").if = "${{ github.ref == 'refs/heads/main' }}"),
      ["expression", "if-form"],
    ],
    [
      "a new job",
      (w) =>
        void ((w.jobs as Obj).extra = {
          name: "x",
          "runs-on": "ubuntu-24.04",
          if: "github.ref == 'refs/heads/main'",
          steps: [],
        }),
      ["job-approval", "steps"],
    ],

    // Round 3, item 1: workflow commands. A line that could print `::` is refused, except the exact mask form and the ::error:: tail of a read.
    ...[
      "::stop-commands::zz",
      "::echo::on",
      "::add-mask::fixed",
      "::warning::x",
      "::debug::x",
      "::group::x",
      "::set-output name=a::b",
      "::error::not through the tail",
    ].flatMap((command): [string, (w: Obj) => void, string[]][] => {
      // stop-commands and the echo toggle are refused twice: as a line and as text anywhere in the file.
      const expected = /stop-commands|::echo::/.test(command) ? ["command", "line"] : ["line"];
      return [
        [
          `a fixed echo of ${command.split("::")[1]} in a read step`,
          appendRun("mfa-reset", 0, `echo "${command}"`),
          expected,
        ],
        [
          `a fixed echo of ${command.split("::")[1]} in the summary`,
          appendRun("summary", 1, `echo "${command}"`),
          expected,
        ],
      ];
    }),
    [
      "a prefix echo that starts a workflow command",
      appendRun("summary", 1, 'echo "::add-mask::${USER_ID:0:8}"'),
      ["line"],
    ],
    [
      "a prefix echo with a stop-commands token",
      appendRun("summary", 1, 'echo "::stop-commands::${USER_ID:0:8}"'),
      ["command", "line"],
    ],
    // The legacy `##[name]` form of a workflow command (lead, after round 3).
    [
      "a fixed echo of the legacy ##[echo] toggle in a read step",
      appendRun("mfa-reset", 0, 'echo "##[echo]on"'),
      ["command"],
    ],
    [
      "a fixed echo of a legacy ##[ command in the summary",
      appendRun("summary", 1, 'echo "##[add-mask]fixed"'),
      ["command"],
    ],
    [
      "a case-pattern echo of a workflow command",
      appendRun("summary", 1, 'x) echo "::stop-commands::zz" ;;'),
      ["command", "line"],
    ],
    // Item 2: only the script step may hold env, and exactly its job's set.
    ...SECRET_JOBS.flatMap((job): [string, (w: Obj) => void, string[]][] => [
      [
        `${job}: the secret key moved onto the npm ci step`,
        moveSecret(job, 4, 3),
        ["job-secrets", "step-env"],
      ],
      [
        `${job}: the secret key moved onto checkout`,
        moveSecret(job, 4, 1),
        ["job-secrets", "step-env", "steps"],
      ],
      [
        `${job}: the secret key moved onto setup-node`,
        moveSecret(job, 4, 2),
        ["job-secrets", "step-env", "steps"],
      ],
    ]),
    [
      "an env on the summary job's write step",
      (w) => void (stepsOfJob(w, "summary")[1]!.env = { A: "${{ secrets.SUPABASE_URL }}" }),
      ["expression", "step-env"],
    ],
    // Item 3: secret jobs carry no permissions key.
    ...SECRET_JOBS.map((job): [string, (w: Obj) => void, string[]] => [
      `${job}: permissions: write-all`,
      (w) => void (jobOf(w, job).permissions = "write-all"),
      ["job-approval"],
    ]),
    [
      "a secret job with contents: read of its own",
      (w) => void (jobOf(w, "mfa-reset").permissions = { contents: "read" }),
      ["job-approval"],
    ],
    // Item 4: the names exported through GITHUB_ENV.
    [
      "BASH_ENV exported from an actor id",
      replaceRun("mfa-reset", 0, 'echo "ACTOR_ID=$actor"', 'echo "BASH_ENV=$actor"'),
      ["export-name"],
    ],
    [
      "NODE_OPTIONS exported from an actor id",
      replaceRun("mfa-reset", 0, 'echo "ACTOR_ID=$actor"', 'echo "NODE_OPTIONS=$actor"'),
      ["export-name"],
    ],
    [
      "NODE_DEBUG exported from the mode",
      replaceRun("set-mfa-enforcement", 0, 'echo "MODE=$mode"', 'echo "NODE_DEBUG=$mode"'),
      ["export-name"],
    ],
    [
      "a name swapped with another variable (USER_ID from the actor)",
      replaceRun("mfa-reset", 0, 'echo "USER_ID=$user"', 'echo "USER_ID=$actor"'),
      ["export-name", "mask-order"],
    ],
    [
      "CONFIRMED exported in a job that does not need it",
      appendRun("mfa-reset", 0, 'echo "CONFIRMED=$confirmed" >> "$GITHUB_ENV"'),
      ["export-name"],
    ],
    // Item 6: checks that every proof now covers.
    [
      "a second script step in mfa-reset",
      (w) =>
        void (jobOf(w, "mfa-reset").steps as Json[]).push({
          run: "npx tsx scripts/create-tenant.ts",
        }),
      ["script", "steps"],
    ],
    [
      "another script in place of the mfa-reset one",
      (w) =>
        void (stepsOfJob(w, "mfa-reset")[4]!.run =
          'npx tsx scripts/set-mfa-enforcement.ts --tenant "$TENANT_ID" --mode "$MODE" --actor "$ACTOR_ID"'),
      ["script"],
    ],
    [
      "mfa-reset without --yes",
      (w) =>
        void (stepsOfJob(w, "mfa-reset")[4]!.run =
          'npx tsx scripts/mfa-reset.ts --user "$USER_ID" --actor "$ACTOR_ID"'),
      ["script"],
    ],
    [
      "a job on another runner",
      (w) => void (jobOf(w, "summary")["runs-on"] = "ubuntu-latest"),
      ["runs-on"],
    ],
    [
      "a top-level permissions of contents: write",
      (w) => void (w.permissions = { contents: "write" }),
      ["permissions"],
    ],
    ["no top-level permissions", (w) => void delete w.permissions, ["permissions"]],
    [
      "an input option removed",
      (w) => void ((inputsOf(w).mode as Obj).options = ["scegli", "off", "enrolled"]),
      ["input-shape"],
    ],
    [
      "an input option added",
      (w) =>
        void ((inputsOf(w).operation as Obj).options = [
          "mfa-reset",
          "set-mfa-enforcement",
          "create-tenant",
          "bootstrap",
        ]),
      ["input-shape"],
    ],
    [
      "an input attribute key added",
      (w) => void ((inputsOf(w).user as Obj).deprecationMessage = "x"),
      ["input-shape"],
    ],
    [
      "an input type changed",
      (w) => void ((inputsOf(w).user as Obj).type = "boolean"),
      ["input-shape"],
    ],
    [
      "an input default changed",
      (w) => void ((inputsOf(w).mode as Obj).default = "off"),
      ["input-shape"],
    ],
  ];

  it.each(mutations)("%s", (_label, change, expected) => {
    expect(firedBy(change)).toEqual([...expected].sort());
  });
});

describe("platform-ops workflow: the review notice", () => {
  it("opens with the header that says changes to this file need the lead's line-by-line read; the guard is a safety net, not the review", () => {
    const header = workflowText.split("\n").slice(0, 12).join("\n");
    expect(header).toMatch(/line-by-line read/i);
    expect(header).toMatch(/lead/i);
    expect(header).toMatch(/safety net, not the review/i);
  });
});

describe("platform-ops workflow", () => {
  it("is started by hand only", () => {
    expect(Object.keys(doc.on as Obj)).toEqual(["workflow_dispatch"]);
  });

  it("has the jobs summary, mfa-reset, set-mfa-enforcement and create-tenant, and no other", () => {
    expect(Object.keys(doc.jobs as Obj).sort()).toEqual([...SECRET_JOBS, "summary"].sort());
  });

  it("pins the runner image (ci-runner-image rule), a read-only token and no persisted credentials", () => {
    const runners = Object.keys(doc.jobs as Obj).map((j) => jobOf(doc, j)["runs-on"]);
    expect(runners).toEqual(Array(4).fill("ubuntu-24.04"));
    expect(doc.permissions).toEqual({ contents: "read" });
    expect(workflowText.match(/persist-credentials: false/g)).toHaveLength(3);
  });

  it("every job runs only from main", () => {
    for (const job of Object.keys(doc.jobs as Obj))
      expect(String(jobOf(doc, job).if)).toContain("github.ref == 'refs/heads/main'");
  });

  it("the summary job has no environment, no secret and no token permission at all", () => {
    const summary = jobOf(doc, "summary");
    expect(summary.environment).toBeUndefined();
    expect(summary.permissions).toEqual({});
    expect(JSON.stringify(summary)).not.toContain("secrets.");
  });

  it("every job that reads a secrets.* value has environment platform-ops and needs the summary job", () => {
    const withSecrets = Object.keys(doc.jobs as Obj).filter((j) =>
      JSON.stringify(jobOf(doc, j)).includes("secrets."),
    );
    expect(withSecrets.sort()).toEqual([...SECRET_JOBS].sort());
    for (const name of withSecrets) {
      expect(jobOf(doc, name).environment).toBe("platform-ops");
      expect(jobOf(doc, name).needs).toBe("summary");
    }
  });

  it("reads exactly the secret names of the environment (FS-1 and the four tenant values), one per variable", () => {
    const used = [
      ...new Set([...workflowText.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1])),
    ];
    expect(used.sort()).toEqual([
      "OWNER_EMAIL",
      "OWNER_NAME",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_URL",
      "TENANT_NAME",
      "TENANT_VAT_NUMBER",
    ]);
  });

  it("platform-ops never passes --ids-out, and the retired unmask switch does not exist", () => {
    expect(workflowText).not.toContain("ids-out");
    expect(workflowText).not.toContain("CREATE_TENANT_" + "FULL_ID");
  });

  it("input names are the exact list and never match mail|email|password|secret|key|name", () => {
    const names = Object.keys(((doc.on as Obj).workflow_dispatch as Obj).inputs as Obj);
    expect(names.sort()).toEqual(INPUT_NAMES);
    for (const name of names) expect(name).not.toMatch(BANNED_INPUT_NAME);
  });

  it("no input carries a name, an address or a VAT number: tenant and owner data are environment secrets", () => {
    const create = JSON.stringify(jobOf(doc, "create-tenant"));
    for (const secret of TENANT_VARS) expect(create).toContain(`secrets.${secret}`);
    expect(create.match(/inputs\.[a-z_]+/g)).toEqual(["inputs.operation"]);
  });
});

/** Runs a job's first step (its real shell text) against a fake event, in a scratch folder, with the runner's files. */
function runReadStep(job: string, inputs: Record<string, unknown>) {
  const first = runOf(doc, job, 0);
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
    for (const mode of ["scegli", "", "off required", "Required"])
      expect(
        runReadStep("set-mfa-enforcement", {
          operation: "set-mfa-enforcement",
          tenant: TENANT,
          actor: ACTOR,
          mode,
        }).status,
        mode,
      ).not.toBe(0);
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

describe("platform-ops workflow: the inputs and the jobs", () => {
  const inputs = ((doc.on as Obj).workflow_dispatch as Obj).inputs as Obj;

  it("conferma_disconnessione is a required boolean whose description is the confirm text, word for word", () => {
    const input = inputs.conferma_disconnessione as Obj;
    expect(input.type).toBe("boolean");
    expect(input.required).toBe(true);
    expect(input.description).toBe(MFA_RESET_CONFIRM_TEXT);
  });

  it("the confirm text is the one the plan gives (da approvare)", () => {
    expect(MFA_RESET_CONFIRM_TEXT).toBe(
      "La persona verrà disconnessa da tutti i locali in cui ha un accesso (e dalla console, se è l'account DigiAlto) e al prossimo accesso dovrà attivare di nuovo il codice.",
    );
  });

  it("mode has no default: a required choice that starts on a sentinel the workflow refuses", () => {
    const mode = inputs.mode as Obj;
    expect(mode.required).toBe(true);
    expect(mode.default).toBe("scegli");
    expect(mode.options).toEqual(["scegli", "off", "enrolled", "required"]);
    const read = runOf(doc, "set-mfa-enforcement", 0);
    expect(read).toContain('"off enrolled required"');
    expect(read).not.toContain("scegli");
  });

  it("the summary job writes the confirm text, short ids, the secrets reminder; its errors go to the log, not the summary", () => {
    const summary = runOf(doc, "summary", 1);
    expect(summary).toContain(MFA_RESET_CONFIRM_TEXT);
    for (const id of PREFIX_IDS) expect(summary).toContain(`\${${id}:0:8}`);
    for (const line of summary.split("\n").filter((l) => l.includes("::error::")))
      expect(line).not.toContain("GITHUB_STEP_SUMMARY");
    expect(summary).toContain(
      "Dopo l'esecuzione elimina i quattro segreti: TENANT_NAME, TENANT_VAT_NUMBER, OWNER_EMAIL, OWNER_NAME",
    );
    expect(summary).toMatch(/exit 1/);
  });

  it("mfa-reset runs only for its operation and only when the confirmation is ticked, and passes --yes", () => {
    expect(jobOf(doc, "mfa-reset").if).toBe(
      "github.ref == 'refs/heads/main' && inputs.operation == 'mfa-reset' && inputs.conferma_disconnessione == true",
    );
    expect(runOf(doc, "mfa-reset", 4)).toBe(
      'npx tsx scripts/mfa-reset.ts --user "$USER_ID" --actor "$ACTOR_ID" --yes',
    );
    for (const other of ["set-mfa-enforcement", "create-tenant"])
      expect(JSON.stringify(jobOf(doc, other))).not.toContain("--yes");
  });

  it("set-mfa-enforcement runs the script with the tenant, the mode and the actor", () => {
    expect(jobOf(doc, "set-mfa-enforcement").if).toContain(
      "inputs.operation == 'set-mfa-enforcement'",
    );
    expect(runOf(doc, "set-mfa-enforcement", 4)).toBe(
      'npx tsx scripts/set-mfa-enforcement.ts --tenant "$TENANT_ID" --mode "$MODE" --actor "$ACTOR_ID"',
    );
  });

  it("create-tenant runs the script with no arguments: the data is in the environment", () => {
    expect(jobOf(doc, "create-tenant").if).toContain("inputs.operation == 'create-tenant'");
    expect(runOf(doc, "create-tenant", 4)).toBe("npx tsx scripts/create-tenant.ts");
  });

  it("every uses: is pinned to a full commit SHA, with its tag in a comment", () => {
    const uses = [...workflowText.matchAll(/^\s*- uses: (\S+)(.*)$/gm)];
    expect(uses).toHaveLength(6);
    for (const [, ref, rest] of uses) {
      expect(ref).toMatch(FULL_SHA_USES);
      expect(rest).toMatch(/^ # v\d+\.\d+\.\d+$/);
    }
    // No npm cache key (package-manager-cache: false is required, so match the bare key only).
    expect(workflowText).not.toMatch(/^\s*cache:/m);
    expect(workflowText.match(/^\s*package-manager-cache: false$/gm)).toHaveLength(3);
  });

  it("each script job installs with npm ci, runs with npx tsx (not npm run) and has a timeout", () => {
    for (const name of SECRET_JOBS) {
      // No dependency install script runs in a job that later holds the key (lead).
      expect(runOf(doc, name, 3)).toBe("npm ci --ignore-scripts");
      expect(runOf(doc, name, 4)).toMatch(/^npx tsx scripts\//);
      expect(jobOf(doc, name)["timeout-minutes"]).toBeGreaterThan(0);
    }
  });
});
