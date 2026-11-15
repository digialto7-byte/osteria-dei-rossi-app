import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Repo-wide guard for every workflow file (supply chain):
//  1. every `uses:` is pinned to a full 40-hex commit SHA and says which release it is in a trailing `# vX.Y.Z`;
//  2. a job that holds secrets (a secret other than GITHUB_TOKEN, or an `environment:`) restores no npm cache, and installs with
//     `npm ci --ignore-scripts` unless the line carries `# install scripts needed: <reason>`.
// js-yaml is not a direct dependency on main, so this reads the files line by line (the workflows use a fixed 2-space layout).
const DIR = new URL("../../.github/workflows/", import.meta.url);

type WorkflowFile = { name: string; text: string };

const REF = /^[a-z0-9-]+\/[a-z0-9._-]+(\/[a-z0-9._/-]+)?@[0-9a-f]{40}$/;
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(.*)$/;
const USES_FULL = /^\s*(?:-\s+)?uses:\s+(\S+) # v\d+\.\d+\.\d+$/;
const NON_TOKEN_SECRET = /\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)\w+/;
const INSTALL = /\bnpm\s+(?:ci|install|i)\b/;
const IGNORE_SCRIPTS = /\bnpm\s+ci\s+--ignore-scripts\b/;
const SCRIPTS_NEEDED = /#\s*install scripts needed:\s*\S+/;

const files = (): WorkflowFile[] =>
  readdirSync(DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => ({ name, text: readFileSync(new URL(name, DIR), "utf8") }));

const isComment = (line: string) => line.trim().startsWith("#");

function pinViolations({ name, text }: WorkflowFile): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (isComment(line)) return;
    const found = USES_LINE.exec(line);
    if (!found) return;
    const at = `${name}:${i + 1}`;
    const full = USES_FULL.exec(line);
    if (!full) {
      out.push(`${at}: uses line must be '<owner>/<repo>@<40-hex> # vX.Y.Z': ${line.trim()}`);
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
    const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(text);
    if (id) {
      jobs.push({ id: id[1] as string, lines: [] });
      return;
    }
    const current = jobs.at(-1);
    if (current) current.lines.push({ n: start + offset + 2, text });
  });
  return { header: lines.slice(0, start), jobs };
}

function secretJobIds({ text }: WorkflowFile): string[] {
  const { header, jobs } = jobsOf(text);
  // A secret in the top-level env reaches every job.
  const globalSecret = header.some((l) => !isComment(l) && NON_TOKEN_SECRET.test(l));
  return jobs
    .filter(
      (job) =>
        globalSecret ||
        job.lines.some(
          (l) =>
            !isComment(l.text) &&
            (NON_TOKEN_SECRET.test(l.text) || /^ {4}environment:/.test(l.text)),
        ),
    )
    .map((job) => job.id);
}

function secretJobViolations(file: WorkflowFile): string[] {
  const secret = new Set(secretJobIds(file));
  const out: string[] = [];
  for (const job of jobsOf(file.text).jobs) {
    if (!secret.has(job.id)) continue;
    for (const { n, text } of job.lines) {
      if (isComment(text)) continue;
      const at = `${file.name}:${n} (job ${job.id})`;
      if (/^\s+cache:\s/.test(text))
        out.push(`${at}: no setup-node cache in a job that holds secrets: ${text.trim()}`);
      const use = USES_LINE.exec(text);
      if (use && /^actions\/cache[/@]/.test(use[1] ?? ""))
        out.push(`${at}: no actions/cache in a job that holds secrets`);
      if (INSTALL.test(text) && !IGNORE_SCRIPTS.test(text) && !SCRIPTS_NEEDED.test(text)) {
        out.push(
          `${at}: use 'npm ci --ignore-scripts' or add '# install scripts needed: <reason>': ${text.trim()}`,
        );
      }
    }
  }
  return out;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
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
      (sum, f) => sum + f.text.split("\n").filter((l) => !isComment(l) && USES_LINE.test(l)).length,
      0,
    );
    expect(count).toBeGreaterThanOrEqual(36);
  });

  describe("mutation proofs", () => {
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
  const SECRET_JOBS: Record<string, string[]> = {
    "backup-daily.yml": ["backup"],
    "backup-restore-weekly.yml": ["restore"],
    "demo-staging.yml": ["demo"],
    "deploy-production.yml": ["migrate"],
    "deploy-staging.yml": ["migrate"],
    "extraction-contract.yml": ["contract"],
    "perf-dashboard-4g.yml": ["timing"],
    "perf-order-entry.yml": ["timing"],
    "t1-staging.yml": ["spike"],
  };

  it("detects exactly the jobs that hold secrets", () => {
    const found = Object.fromEntries(
      all.map((f) => [f.name, secretJobIds(f)] as const).filter(([, ids]) => ids.length > 0),
    );
    expect(found).toEqual(SECRET_JOBS);
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
  });
});
