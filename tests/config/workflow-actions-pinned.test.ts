import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Repo-wide guard for every workflow file and local action file (supply chain):
//  1. every `uses:` is pinned to a full 40-hex commit SHA and says which release it is in a trailing `# vX.Y.Z`;
//     the only accepted shape is the plain block-style line, so flow-style steps, quoted keys and `uses :` are refused;
//  2. a job that holds secrets (any `${{ }}` that mentions `secrets` other than exactly secrets.GITHUB_TOKEN, a job-level `secrets:`,
//     or an `environment:`) restores no npm cache (setup-node `cache:` off and `package-manager-cache: false`) and installs with
//     `npm ci --ignore-scripts` unless the line carries `# install scripts needed: <reason>`.
// js-yaml is not a direct dependency on main, so this reads the files line by line (the workflows use a fixed 2-space layout:
// the parser relies on Prettier's 2-space YAML indent, which `npm run format:check` enforces).
const ROOT = new URL("../../.github/", import.meta.url);
const DIR = new URL("workflows/", ROOT);

type WorkflowFile = { name: string; text: string };

const REF = /^[a-z0-9-]+\/[a-z0-9._-]+(\/[a-z0-9._/-]+)?@[0-9a-f]{40}$/;
const USES_FULL = /^\s*(?:-\s+)?uses: (\S+) # v\d+\.\d+\.\d+$/;
// Any spelling of the key: block, flow-style (`- { uses: x }`), quoted, or with a space before the colon.
const USES_ANY = /(?:^|[\s{,-])["']?uses["']?\s*:/;
const SCRIPTS_NEEDED = /#\s*install scripts needed:\s*\S+/;
// npm 10's command aliases (`npm <cmd> --help`): any spelling of these commands counts.
const NPM_CI_ALIASES = ["ci", "clean-install", "ic", "install-clean", "isntall-clean"];
const NPM_BANNED_ALIASES = [
  // install
  "install",
  "add",
  "i",
  "in",
  "ins",
  "inst",
  "insta",
  "instal",
  "isnt",
  "isnta",
  "isntal",
  "isntall",
  // install-test
  "install-test",
  "it",
  // install-ci-test
  "install-ci-test",
  "cit",
  "clean-install-test",
  "sit",
  // rebuild
  "rebuild",
  "rb",
];
const wordAlt = (names: string[]) => names.map((n) => n.replace(/[-]/g, "\\-")).join("|");
const BANNED_INSTALL = new RegExp(`\\bnpm\\s+(?:${wordAlt(NPM_BANNED_ALIASES)})(?:\\s|$)`);
const NPM_CI = new RegExp(`\\bnpm\\s+(?:${wordAlt(NPM_CI_ALIASES)})(?:\\s|$)`);
// `npx ...` and `npm exec ...` / `npm x ...`, up to the end of the command.
const NPX_CALL = /(?:^|[\s;&|(])(?:npx|npm\s+(?:exec|x))(?=\s|$)([^;&|]*)/g;
// Only npx's own flags, which come before the package name; `npx supabase db push --yes` passes --yes to supabase.
const AUTO_YES = /\b(?:npx|npm\s+exec|npm\s+x)\s+(?:-\S+\s+)*(?:--yes|-y)(?:\s|$)/;

const listFiles = (dir: string, match: RegExp): WorkflowFile[] =>
  readdirSync(dir)
    .filter((name) => match.test(name))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));

const files = (): WorkflowFile[] => listFiles(DIR.pathname, /\.ya?ml$/);

// Local actions: .github/actions/<name>/action.yml. A missing directory means there are none.
function actionFiles(dir: string): WorkflowFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      listFiles(join(dir, entry.name), /^action\.ya?ml$/).map((f) => ({
        ...f,
        name: `actions/${entry.name}/${f.name}`,
      })),
    );
}

const isComment = (line: string) => line.trim().startsWith("#");
const code = (line: string) => line.replace(/\s+#.*$/, "");

function pinViolations({ name, text }: WorkflowFile): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (isComment(line) || !USES_ANY.test(line)) return;
    const at = `${name}:${i + 1}`;
    const full = USES_FULL.exec(line);
    if (!full) {
      out.push(
        `${at}: uses line must be '<owner>/<repo>@<40-hex> # vX.Y.Z' in plain block style: ${line.trim()}`,
      );
      return;
    }
    const ref = full[1] ?? "";
    if (!REF.test(ref)) out.push(`${at}: not pinned to a full commit SHA: ${ref}`);
  });
  return out;
}

type Job = { id: string; lines: { n: number; text: string }[] };

function jobsOf(text: string): { header: string[]; jobs: Job[] } {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === "jobs:");
  if (start < 0) throw new Error("workflow has no top-level 'jobs:'");
  const jobs: Job[] = [];
  lines.slice(start + 1).forEach((text, offset) => {
    const id = /^ {2}["']?([A-Za-z0-9_-]+)["']?:\s*(?:#.*)?$/.exec(text);
    if (id) {
      jobs.push({ id: id[1] as string, lines: [] });
      return;
    }
    const current = jobs.at(-1);
    if (current) current.lines.push({ n: start + offset + 2, text });
  });
  return { header: lines.slice(0, start), jobs };
}

// True when a ${{ }} expression on the line mentions secrets, other than exactly secrets.GITHUB_TOKEN.
function mentionsSecrets(line: string): boolean {
  if (isComment(line)) return false;
  return [...line.matchAll(/\$\{\{(.*?)\}\}/g)].some((m) =>
    /\bsecrets\b/.test((m[1] ?? "").replace(/\bsecrets\.GITHUB_TOKEN\b(?![\w-])/g, "")),
  );
}

function secretJobIds({ text }: WorkflowFile): string[] {
  const { header, jobs } = jobsOf(text);
  // A secret in the top-level env reaches every job.
  const globalSecret = header.some(mentionsSecrets);
  return jobs
    .filter(
      (job) =>
        globalSecret ||
        job.lines.some(
          (l) =>
            mentionsSecrets(l.text) ||
            (!isComment(l.text) && /^ {4}(?:environment|secrets)\s*:/.test(l.text)),
        ),
    )
    .map((job) => job.id);
}

// What npx may resolve locally. `packages` are package.json's dependencies and devDependencies: the only values -p/--package may take.
// `tools` add the bins those packages provide, which a bare command may name (npx playwright is the bin of @playwright/test, npx tsc of
// typescript); as a package spec a bin name such as `tsc` would be an unrelated registry package.
function localTools(root: string): { packages: Set<string>; tools: Set<string> } {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  const tools = new Set(names);
  for (const name of names) {
    const file = join(root, "node_modules", name, "package.json");
    if (!existsSync(file))
      throw new Error(
        `${name} is listed in package.json but missing from node_modules: node_modules is stale: run npm ci`,
      );
    const dep = JSON.parse(readFileSync(file, "utf8")) as { bin?: string | Record<string, string> };
    if (typeof dep.bin === "string") tools.add(name.split("/").pop() as string);
    else for (const bin of Object.keys(dep.bin ?? {})) tools.add(bin);
  }
  return { packages: new Set(names), tools };
}
const LOCAL = localTools(new URL("../../", import.meta.url).pathname);
const VALUE_FLAGS = new Set(["-w", "--workspace"]);
// `name@x`, `@scope/name@x`: a version or tag makes npx fetch something other than the locked package.
const VERSIONED = /^(?:@[^/@]+\/)?[^@/\s]+@/;

// An npx / npm exec call: the packages named by -p/--package and the command word (the first word that is not a flag).
function npxCall(args: string): { packages: string[]; command?: string; shell: boolean } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const packages: string[] = [];
  let command: string | undefined;
  let shell = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    if (t === "--") {
      command ??= tokens[i + 1];
      break;
    }
    const inline = /^(?:-p|--package)=(.+)$/.exec(t);
    if (inline) packages.push(inline[1] as string);
    else if (t === "-p" || t === "--package") packages.push(tokens[++i] ?? "");
    else if (t === "-c" || t === "--call" || t.startsWith("--call=")) shell = true;
    else if (VALUE_FLAGS.has(t)) i++;
    else if (!t.startsWith("-")) {
      command = t;
      break;
    }
  }
  return { packages, command, shell };
}

function npxViolation(c: string): string | null {
  for (const match of c.matchAll(NPX_CALL)) {
    const call = npxCall(match[1] ?? "");
    if (call.shell) return "npx -c / --call runs a shell string that is not checked";
    if (call.packages.length === 0 && !call.command) return "npx / npm exec must name a package";
    for (const spec of [...call.packages, ...(call.command ? [call.command] : [])])
      if (VERSIONED.test(spec))
        return `npx / npm exec '${spec}' is a versioned or tagged spec (it would be downloaded, not the locked package)`;
    for (const name of call.packages)
      if (!LOCAL.packages.has(name))
        return `npx / npm exec -p '${name}' is not a dependency or devDependency (-p takes package names, not bins)`;
    if (call.command && !LOCAL.tools.has(call.command))
      return `npx / npm exec '${call.command}' is not a dependency, devDependency or one of their bins (it would be downloaded)`;
  }
  return null;
}

// The shell commands of a job's run: steps, one per logical line (a trailing backslash joins the next line), with their line numbers.
function runCommands(
  lines: { n: number; text: string }[],
): { n: number; raw: string; command: string }[] {
  const physical: { n: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as { n: number; text: string };
    const key = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(line.text);
    if (!key) continue;
    const indent = (key[1] ?? "").length + (key[2] ? 2 : 0);
    const rest = key[3] ?? "";
    if (!/^[|>][+-]?\d*\s*$/.test(rest)) {
      physical.push({ n: line.n, text: rest });
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] as { n: number; text: string };
      if (next.text.trim() !== "" && next.text.length - next.text.trimStart().length <= indent)
        break;
      if (!isComment(next.text)) physical.push(next);
    }
  }
  type Cmd = { n: number; raw: string; command: string };
  const out: Cmd[] = [];
  let current: Cmd | undefined;
  for (const { n, text } of physical) {
    const continued = /\\\s*$/.test(text);
    const piece = code(text).replace(/\\\s*$/, "");
    current = current
      ? { ...current, raw: `${current.raw} ${text}`, command: `${current.command} ${piece}` }
      : { n, raw: text, command: piece };
    if (!continued) {
      out.push(current);
      current = undefined;
    }
  }
  if (current) out.push(current);
  return out;
}

function installViolation(line: string, command: string): string | null {
  // Shell quoting and punctuation around tokens do not hide a command.
  const c = command.replace(/[()"'`]/g, " ");
  if (BANNED_INSTALL.test(c))
    return "npm install, add, it, install-ci-test, rebuild and their aliases are not allowed";
  if (AUTO_YES.test(c)) return "npx --yes/-y and npm exec --yes download and run code unasked";
  const unknown = npxViolation(c);
  if (unknown) return unknown;
  if (NPM_CI.test(c) && !SCRIPTS_NEEDED.test(line)) {
    const flags = c.split(/\s+/).filter((t) => /^--(?:no-)?ignore-scripts(?:=|$)/.test(t));
    const ok =
      flags.length === 1 &&
      (flags[0] === "--ignore-scripts" || flags[0] === "--ignore-scripts=true");
    if (!ok) return "use 'npm ci --ignore-scripts' or add '# install scripts needed: <reason>'";
  }
  return null;
}

function secretJobViolations(file: WorkflowFile): string[] {
  const secret = new Set(secretJobIds(file));
  const out: string[] = [];
  for (const job of jobsOf(file.text).jobs) {
    if (!secret.has(job.id)) continue;
    job.lines.forEach(({ n, text }, idx) => {
      if (isComment(text)) return;
      const at = `${file.name}:${n} (job ${job.id})`;
      if (/^\s+cache:\s/.test(text))
        out.push(`${at}: no setup-node cache in a job that holds secrets: ${text.trim()}`);
      const use = /^\s*(?:-\s+)?uses:\s*(\S*)/.exec(text);
      const action = use?.[1] ?? "";
      if (/^actions\/cache[/@]/.test(action))
        out.push(`${at}: no actions/cache in a job that holds secrets`);
      if (/^actions\/setup-node@/.test(action)) {
        const rest = job.lines.slice(idx + 1);
        const end = rest.findIndex((l) => /^ {6}- /.test(l.text));
        const step = end < 0 ? rest : rest.slice(0, end);
        if (!step.some((l) => /^\s+package-manager-cache:\s*false\s*$/.test(l.text)))
          out.push(
            `${at}: setup-node needs 'package-manager-cache: false' in a job that holds secrets`,
          );
      }
    });
    for (const { n, raw, command } of runCommands(job.lines)) {
      const bad = installViolation(raw, command);
      if (bad) out.push(`${file.name}:${n} (job ${job.id}): ${bad}: ${raw.trim()}`);
    }
  }
  return out;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
// A secret job whose steps are the given run commands: the first as a block (so it may span lines), the rest one-liners.
const secretRun = (block: string, ...oneLiners: string[]): WorkflowFile => ({
  name: "synthetic.yml",
  text: [
    "jobs:",
    "  a:",
    "    environment: staging",
    "    steps:",
    "      - name: block",
    "        run: |",
    ...block.split("\n").map((l) => (l.startsWith(" ") ? l : `          ${l}`)),
    ...oneLiners.map((c) => `      - run: ${c}`),
    "",
  ].join("\n"),
});
const all = files();
const byName = (name: string) => {
  const file = all.find((f) => f.name === name);
  if (!file) throw new Error(`no workflow ${name}`);
  return file;
};
const mutate = (name: string, from: string | RegExp, to: string): WorkflowFile => {
  const file = byName(name);
  const text = file.text.replace(from, to);
  if (text === file.text) throw new Error(`mutation did not change ${name}: ${String(from)}`);
  return { name, text };
};

describe("every workflow action is pinned to a commit SHA", () => {
  it("finds the workflow files", () => {
    expect(all.length).toBeGreaterThanOrEqual(13);
  });

  it.each(all.map((f) => f.name))("%s: every uses: is <owner>/<repo>@<40-hex> # vX.Y.Z", (name) => {
    expect(pinViolations(byName(name))).toEqual([]);
  });

  it("counts the uses lines, so the check cannot go blind", () => {
    const count = all.reduce(
      (sum, f) => sum + f.text.split("\n").filter((l) => !isComment(l) && USES_ANY.test(l)).length,
      0,
    );
    expect(count).toBeGreaterThanOrEqual(36);
  });

  it("has no comment that says the actions are on version tags or that no SHA could be verified", () => {
    for (const f of all) {
      const stale = f.text
        .split("\n")
        .filter((l) => isComment(l) && /version tags?|no commit sha/i.test(l));
      expect(stale, f.name).toEqual([]);
    }
  });

  it("scans local actions under .github/actions, and a missing directory means none", () => {
    expect(actionFiles(join(ROOT.pathname, "does-not-exist"))).toEqual([]);
    for (const f of actionFiles(join(ROOT.pathname, "actions")))
      expect(pinViolations(f), f.name).toEqual([]);
  });

  describe("mutation proofs", () => {
    it("refuses flow-style steps, quoted keys and a space before the colon", () => {
      for (const line of [
        "      - { uses: actions/checkout@v5 }",
        `      - { uses: actions/checkout@${SHA}, with: { x: 1 } }`,
        `      - "uses": actions/checkout@${SHA} # v5.1.0`,
        `      - 'uses': actions/checkout@${SHA} # v5.1.0`,
        `      - uses : actions/checkout@${SHA} # v5.1.0`,
        `        uses :   actions/checkout@v5`,
      ]) {
        const bad: WorkflowFile = { name: "f.yml", text: `jobs:\n  a:\n    steps:\n${line}\n` };
        expect(pinViolations(bad), line).not.toEqual([]);
      }
    });
    it("checks local action files with the same rule", async () => {
      const bad: WorkflowFile = {
        name: "actions/x/action.yml",
        text: "runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v5\n",
      };
      expect(pinViolations(bad)).not.toEqual([]);
    });
    it("refuses a tag ref", () => {
      const bad = mutate(
        "ci.yml",
        /actions\/checkout@[0-9a-f]{40} # v[\d.]+/,
        "actions/checkout@v5 # v5.1.0",
      );
      expect(pinViolations(bad).join("\n")).toContain(
        "not pinned to a full commit SHA: actions/checkout@v5",
      );
    });
    it("refuses a branch ref", () => {
      const bad = mutate(
        "ci.yml",
        /actions\/checkout@[0-9a-f]{40} # v[\d.]+/,
        "actions/checkout@main # v5.1.0",
      );
      expect(pinViolations(bad).join("\n")).toContain("actions/checkout@main");
    });
    it("refuses a short SHA", () => {
      const bad = mutate(
        "ci.yml",
        /actions\/checkout@[0-9a-f]{40} # v[\d.]+/,
        "actions/checkout@fbc6f39 # v5.1.0",
      );
      expect(pinViolations(bad).join("\n")).toContain("actions/checkout@fbc6f39");
    });
    it("refuses a SHA without the release comment", () => {
      const bad = mutate("ci.yml", /(actions\/checkout@[0-9a-f]{40}) # v[\d.]+/, "$1");
      expect(pinViolations(bad).join("\n")).toContain("# vX.Y.Z");
    });
    it("refuses a release comment that is not a version", () => {
      const bad = mutate("ci.yml", /(actions\/checkout@[0-9a-f]{40}) # v[\d.]+/, "$1 # latest");
      expect(pinViolations(bad)).not.toEqual([]);
    });
    it("refuses an uppercase owner", () => {
      const bad = mutate("ci.yml", /actions\/checkout@[0-9a-f]{40}/, `Actions/checkout@${SHA}`);
      expect(pinViolations(bad).join("\n")).toContain("Actions/checkout");
    });
    it("refuses local actions and docker images", () => {
      for (const ref of ["./.github/actions/x", "docker://alpine:3.20"]) {
        const bad = mutate(
          "ci.yml",
          /uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+/,
          `uses: ${ref} # v1.0.0`,
        );
        expect(pinViolations(bad), ref).not.toEqual([]);
      }
    });
    it("refuses a new workflow file with an unpinned action", () => {
      const fresh: WorkflowFile = {
        name: "new-workflow.yml",
        text: "name: New\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: some-org/some-action@v1\n",
      };
      const violations = [...all, fresh].flatMap(pinViolations);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("new-workflow.yml:7");
    });
    it("accepts a correctly pinned action (positive control)", () => {
      const ok: WorkflowFile = {
        name: "ok.yml",
        text: `jobs:\n  a:\n    steps:\n      - uses: some-org/some-action/sub@${SHA} # v1.2.3\n`,
      };
      expect(pinViolations(ok)).toEqual([]);
    });
  });
});

describe("jobs that hold secrets: no cache, no install scripts", () => {
  // Hard-coded on purpose: a new job that holds secrets has to be added here by hand.
  const SECRET_JOBS = [
    "backup-daily.yml:backup",
    "backup-restore-weekly.yml:restore",
    "demo-staging.yml:demo",
    "deploy-production.yml:migrate",
    "deploy-staging.yml:migrate",
    "extraction-contract.yml:contract",
    "perf-dashboard-4g.yml:timing",
    "perf-order-entry.yml:timing",
    "platform-ops.yml:create-tenant",
    "platform-ops.yml:mfa-reset",
    "platform-ops.yml:set-mfa-enforcement",
    "t1-staging.yml:spike",
  ];

  it("detects exactly the jobs that hold secrets", () => {
    const found = all.flatMap((f) => secretJobIds(f).map((id) => `${f.name}:${id}`));
    expect(found.sort()).toEqual([...SECRET_JOBS].sort());
  });

  it.each(all.map((f) => f.name))("%s follows the secret-job rules", (name) => {
    expect(secretJobViolations(byName(name))).toEqual([]);
  });

  it("leaves jobs without secrets alone (ci.yml keeps its npm cache)", () => {
    expect(byName("ci.yml").text).toContain("cache: npm");
    expect(secretJobViolations(byName("ci.yml"))).toEqual([]);
  });

  describe("mutation proofs", () => {
    it("refuses cache: npm in a secret job", () => {
      const bad = mutate(
        "perf-order-entry.yml",
        /(node-version-file: \.nvmrc\n)/,
        "$1          cache: npm\n",
      );
      expect(secretJobViolations(bad).join("\n")).toContain("no setup-node cache");
    });
    it("refuses an actions/cache step in a secret job", () => {
      const bad = mutate(
        "t1-staging.yml",
        /(\n {6}- run: npm ci --ignore-scripts)/,
        `\n      - uses: actions/cache/restore@${SHA} # v4.3.0\n        with:\n          path: node_modules\n          key: k$1`,
      );
      expect(secretJobViolations(bad).join("\n")).toContain("no actions/cache");
    });
    it("refuses plain npm ci in a secret job", () => {
      const bad = mutate("extraction-contract.yml", "npm ci --ignore-scripts", "npm ci");
      expect(secretJobViolations(bad).join("\n")).toContain("npm ci --ignore-scripts");
    });
    it("refuses npm install in a secret job", () => {
      const bad = mutate("extraction-contract.yml", "npm ci --ignore-scripts", "npm install");
      expect(secretJobViolations(bad)).not.toEqual([]);
    });
    it("accepts plain npm ci with a reason comment", () => {
      const ok = mutate(
        "extraction-contract.yml",
        "npm ci --ignore-scripts",
        "npm ci # install scripts needed: esbuild native fallback",
      );
      expect(secretJobViolations(ok)).toEqual([]);
    });
    it("refuses the comment without a reason", () => {
      const bad = mutate(
        "extraction-contract.yml",
        "npm ci --ignore-scripts",
        "npm ci # install scripts needed:",
      );
      expect(secretJobViolations(bad)).not.toEqual([]);
    });
    it("treats a job with only an environment as a secret job", () => {
      const file: WorkflowFile = {
        name: "env-only.yml",
        text: "jobs:\n  a:\n    environment: staging\n    steps:\n      - run: npm ci\n",
      };
      expect(secretJobIds(file)).toEqual(["a"]);
      expect(secretJobViolations(file)).not.toEqual([]);
    });
    it("treats a job with a secret in a step env as a secret job, but not GITHUB_TOKEN", () => {
      const withSecret: WorkflowFile = {
        name: "s.yml",
        text: "jobs:\n  a:\n    steps:\n      - run: npm ci\n        env:\n          K: ${{ secrets.SOME_KEY }}\n",
      };
      expect(secretJobViolations(withSecret)).not.toEqual([]);
      const tokenOnly: WorkflowFile = {
        name: "t.yml",
        text: "jobs:\n  a:\n    steps:\n      - run: npm ci\n        env:\n          K: ${{ secrets.GITHUB_TOKEN }}\n",
      };
      expect(secretJobIds(tokenOnly)).toEqual([]);
    });
    it("treats every job as a secret job when the top-level env has a secret", () => {
      const file: WorkflowFile = {
        name: "g.yml",
        text: "env:\n  K: ${{ secrets.SOME_KEY }}\njobs:\n  a:\n    steps:\n      - run: npm ci\n",
      };
      expect(secretJobIds(file)).toEqual(["a"]);
      expect(secretJobViolations(file)).not.toEqual([]);
    });

    it("refuses setup-node without package-manager-cache: false in a secret job", () => {
      const bad = mutate("t1-staging.yml", /\n *package-manager-cache: false/, "");
      expect(secretJobViolations(bad).join("\n")).toContain("package-manager-cache: false");
    });
    it.each([
      [
        "secrets: inherit on a job",
        "jobs:\n  a:\n    uses: o/r/.github/workflows/w.yml@x\n    secrets: inherit\n",
      ],
      [
        "a secret in a && || expression",
        "jobs:\n  a:\n    steps:\n      - run: x\n        env:\n          K: ${{ github.ref == 'refs/heads/main' && secrets.PAT || '' }}\n",
      ],
      [
        "a secret inside format()",
        "jobs:\n  a:\n    steps:\n      - run: x\n        env:\n          K: ${{ format('{0}', secrets.PAT) }}\n",
      ],
      [
        "secrets['PAT']",
        "jobs:\n  a:\n    steps:\n      - run: x\n        env:\n          K: ${{ secrets['PAT'] }}\n",
      ],
      [
        "toJSON(secrets)",
        "jobs:\n  a:\n    steps:\n      - run: x\n        env:\n          K: ${{ toJSON(secrets) }}\n",
      ],
      ["a quoted job id", 'jobs:\n  "a":\n    environment: staging\n    steps:\n      - run: x\n'],
      ["a single-quoted job id", "jobs:\n  'a':\n    steps:\n      - run: ${{ secrets.K }}\n"],
      [
        "a secret in the workflow-level env, in format()",
        "env:\n  K: ${{ format('{0}', secrets.PAT) }}\njobs:\n  a:\n    steps:\n      - run: x\n",
      ],
    ])("treats %s as holding secrets", (_label, text) => {
      expect(secretJobIds({ name: "m.yml", text })).toEqual(["a"]);
    });
    it("does not treat the exact secrets.GITHUB_TOKEN as a secret, but secrets.GITHUB_TOKEN_X is one", () => {
      const token =
        "jobs:\n  a:\n    steps:\n      - run: x\n        env:\n          K: ${{ secrets.GITHUB_TOKEN }}\n";
      expect(secretJobIds({ name: "t.yml", text: token })).toEqual([]);
      expect(
        secretJobIds({ name: "t.yml", text: token.replace("GITHUB_TOKEN", "GITHUB_TOKEN_X") }),
      ).toEqual(["a"]);
    });
    it("a comment that mentions secrets does not make a job a secret job", () => {
      const text = "jobs:\n  a:\n    steps:\n      # ${{ secrets.K }}\n      - run: npm ci\n";
      expect(secretJobIds({ name: "c.yml", text })).toEqual([]);
    });
    it.each([
      "npm ci --ignore-scripts=false",
      "npm ci --ignore-scripts=0",
      "npm ci --ignore-scripts --no-ignore-scripts",
      "npm ci --no-ignore-scripts",
      "npm ci --ignore-scripts=false --ignore-scripts",
      "npm ci --ignore-scriptsx",
      "npm rebuild",
      "npm clean-install",
      "npm it",
      "npm install-ci-test",
      "npm install",
      "npm i",
      "npm ci --ignore-scripts && npm rebuild esbuild",
      "npx --yes tsx x.ts",
      "npx -y tsx x.ts",
      "npx --no-install --yes tsx x.ts",
      "npm exec --yes -- tsx x.ts",
    ])("refuses '%s' in a secret job", (cmd) => {
      const bad = mutate("extraction-contract.yml", "npm ci --ignore-scripts", cmd);
      expect(secretJobViolations(bad), cmd).not.toEqual([]);
    });
    it("refuses an install flag even when the install-scripts comment is on a banned command", () => {
      const bad = mutate(
        "extraction-contract.yml",
        "npm ci --ignore-scripts",
        "npm rebuild # install scripts needed: esbuild",
      );
      expect(secretJobViolations(bad)).not.toEqual([]);
    });
    it("accepts npm ci --ignore-scripts=true and `supabase db push --yes` (positive controls)", () => {
      const ok = mutate(
        "extraction-contract.yml",
        "npm ci --ignore-scripts",
        "npm ci --ignore-scripts=true",
      );
      expect(secretJobViolations(ok)).toEqual([]);
      const ok2 = mutate(
        "extraction-contract.yml",
        "npm ci --ignore-scripts",
        "npm ci --ignore-scripts && npx supabase db push --yes",
      );
      expect(secretJobViolations(ok2)).toEqual([]);
    });

    it.each([
      ...[
        "install",
        "add",
        "i",
        "in",
        "ins",
        "inst",
        "insta",
        "instal",
        "isnt",
        "isnta",
        "isntal",
        "isntall",
      ],
      ...[
        "install-test",
        "it",
        "install-ci-test",
        "cit",
        "clean-install-test",
        "sit",
        "rebuild",
        "rb",
      ],
    ])("refuses the npm alias '%s' in a secret job, even with --ignore-scripts", (alias) => {
      const bad = mutate(
        "extraction-contract.yml",
        "npm ci --ignore-scripts",
        `npm ${alias} --ignore-scripts`,
      );
      expect(secretJobViolations(bad), alias).not.toEqual([]);
    });
    it.each(["clean-install", "ic", "install-clean", "isntall-clean"])(
      "treats 'npm %s' like npm ci: it needs --ignore-scripts",
      (alias) => {
        const bad = mutate("extraction-contract.yml", "npm ci --ignore-scripts", `npm ${alias}`);
        expect(secretJobViolations(bad), alias).not.toEqual([]);
        const flagged = mutate(
          "extraction-contract.yml",
          "npm ci --ignore-scripts",
          `npm ${alias} --ignore-scripts`,
        );
        expect(secretJobViolations(flagged), alias).toEqual([]);
        const reasoned = mutate(
          "extraction-contract.yml",
          "npm ci --ignore-scripts",
          `npm ${alias} # install scripts needed: esbuild`,
        );
        expect(secretJobViolations(reasoned), alias).toEqual([]);
      },
    );
    it.each([
      "npx tsxx scripts/x.ts",
      "npx some-unknown-tool",
      "npx --no-install some-unknown-tool",
      "npx -p some-unknown-tool tsx x.ts",
      "npx --package=some-unknown-tool tsx x.ts",
      "npx some-unknown-tool@1.2.3",
      "npx",
      "npm exec some-unknown-tool",
      "npm exec -- some-unknown-tool",
      "npm x some-unknown-tool",
      "npm x --yes tsx x.ts",
      "npx tsx x.ts | npx some-unknown-tool",
    ])("refuses '%s' in a secret job: it would download a package", (cmd) => {
      const bad = mutate(
        "extraction-contract.yml",
        "npm ci --ignore-scripts",
        `npm ci --ignore-scripts && ${cmd}`,
      );
      expect(secretJobViolations(bad), cmd).not.toEqual([]);
    });
    it.each([
      "npx tsx x.ts",
      "npx supabase start -x studio",
      "npx playwright install --with-deps chromium",
      "npx vitest run",
      "npx -p tsx tsx x.ts",
      "npm exec tsx x.ts",
      "npm x -- tsx x.ts",
    ])("accepts '%s' in a secret job: the tool is a dependency or a dependency's bin", (cmd) => {
      const ok = mutate(
        "extraction-contract.yml",
        "npm ci --ignore-scripts",
        `npm ci --ignore-scripts && ${cmd}`,
      );
      expect(secretJobViolations(ok), cmd).toEqual([]);
    });
    it("starts a new job at a job-id line with a trailing comment", () => {
      const text =
        "jobs:\n  a:\n    steps:\n      - run: npm ci\n  b: # deploy\n    environment: staging\n    steps:\n      - run: npm ci --ignore-scripts\n";
      expect(secretJobIds({ name: "j.yml", text })).toEqual(["b"]);
    });

    it.each([
      "npx supabase@latest db push",
      "npx tsx@4.0.0 x.ts",
      "npx tsx@4.23.15 x.ts",
      "npx -p supabase@latest supabase",
      "npx --package=supabase@latest supabase",
      "npx @playwright/test@1.56.1 test",
      "npx -p @playwright/test@1.56.1 playwright test",
      "npm exec supabase@latest -- db push",
      "npm x tsx@4.0.0 x.ts",
    ])("refuses the versioned or tagged spec '%s' in a secret job", (cmd) => {
      const bad = secretRun(cmd);
      expect(secretJobViolations(bad).join("\n"), cmd).toContain("versioned");
    });
    it.each(["npx -p tsc tsc", "npx --package=tsc tsc", "npx -p playwright playwright test"])(
      "refuses '%s': -p takes package names, and tsc / playwright are only bins",
      (cmd) => {
        expect(secretJobViolations(secretRun(cmd)), cmd).not.toEqual([]);
      },
    );
    it.each([
      "npx tsc --noEmit",
      "npx -p @playwright/test playwright test",
      "npx -p typescript tsc",
    ])("accepts '%s': a bare bin, or -p with a package name", (cmd) => {
      expect(secretJobViolations(secretRun(cmd)), cmd).toEqual([]);
    });
    it.each(["npx -c 'tsx x.ts'", "npx --call 'tsx x.ts'"])(
      "refuses '%s': a shell string is not checked",
      (cmd) => {
        expect(secretJobViolations(secretRun(cmd)), cmd).not.toEqual([]);
      },
    );
    it("only checks run: content: a step name that mentions npx or npm install is fine", () => {
      const text = [
        "jobs:",
        "  a:",
        "    environment: staging",
        "    steps:",
        "      - name: Install browsers (npx playwright) after npm install",
        "        run: echo done",
        "      - name: npm ci without flags",
        "        if: contains(github.event.head_commit.message, 'npx foo')",
        "        run: echo ok",
        "",
      ].join("\n");
      expect(secretJobViolations({ name: "n.yml", text })).toEqual([]);
    });
    it("checks every line of a run block, and a one-line run", () => {
      expect(secretJobViolations(secretRun("echo a\n          npx some-unknown-tool")).length).toBe(
        1,
      );
      expect(secretJobViolations(secretRun("echo a", "npm install")).length).toBe(1);
    });
    it("joins a trailing-backslash continuation", () => {
      expect(
        secretJobViolations(secretRun("npx supabase \\\n            start -x studio")),
      ).toEqual([]);
      expect(secretJobViolations(secretRun("npx \\\n            some-unknown-tool"))).not.toEqual(
        [],
      );
      expect(secretJobViolations(secretRun("npm ci \\\n            --ignore-scripts"))).toEqual([]);
      expect(secretJobViolations(secretRun("npm ci \\\n            --foo"))).not.toEqual([]);
    });
    it.each([
      "(npx some-unknown-tool)",
      '"npx some-unknown-tool"',
      "x=$(npx some-unknown-tool)",
      "`npx some-unknown-tool`",
      "npx 'tsxx' x.ts",
    ])("strips shell quoting and punctuation: '%s' is still refused", (cmd) => {
      expect(secretJobViolations(secretRun(cmd)), cmd).not.toEqual([]);
    });
    it("names the package and says node_modules is stale when a dependency is missing", () => {
      const root = mkdtempSync(join(tmpdir(), "tools-"));
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ devDependencies: { "left-pad-x": "1.0.0" } }),
      );
      expect(() => localTools(root)).toThrow(/left-pad-x.*node_modules is stale: run npm ci/);
    });
  });
});
