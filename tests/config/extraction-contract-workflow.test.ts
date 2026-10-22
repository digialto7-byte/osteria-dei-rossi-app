import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import contractConfig from "../../vitest.contract.config";
import unitConfig from "../../vitest.config";

// The live contract job calls the paid API with real secrets, so its safety properties are pinned.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const workflow = read(".github/workflows/extraction-contract.yml");
const SECRET_REF = /\$\{\{\s*secrets\./g;

const steps = workflow
  .slice(workflow.indexOf("    steps:"))
  .split(/\n(?= {6}- )/)
  .slice(1);
const stepContaining = (marker: string) => {
  const step = steps.find((candidate) => candidate.includes(marker));
  if (!step) throw new Error(`no step contains ${marker}`);
  return step;
};

describe("extraction-contract workflow", () => {
  it("runs by hand only", () => {
    expect(workflow).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(workflow).not.toMatch(
      /^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m,
    );
  });

  it("has read-only permissions and uses the extraction-contract environment", () => {
    expect(workflow).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(workflow).toContain("environment: extraction-contract");
  });

  it("references the secrets in one step only, the one that runs the tests", () => {
    expect(workflow.match(SECRET_REF)).toHaveLength(2);
    const testStep = stepContaining("npm run test:contract");
    expect(testStep.match(SECRET_REF)).toHaveLength(2);
    expect(testStep).toContain("secrets.ANTHROPIC_API_KEY");
    expect(testStep).toContain("secrets.EXTRACTION_MODEL_ID");
  });

  it("installs dependencies without the secrets in the environment", () => {
    const install = stepContaining("npm ci");
    expect(install).not.toMatch(SECRET_REF);
    expect(install).not.toContain("env:");
  });

  it("does not leave the GitHub token in the checkout, and still runs npm ci with install scripts", () => {
    const checkout = stepContaining("actions/checkout");
    expect(checkout).toMatch(/persist-credentials:\s*false/);
    // esbuild and tsx may need their install scripts, so the install is not run with the flag off.
    expect(stepContaining("npm ci")).not.toContain("--ignore-scripts");
    expect(workflow).not.toContain("--ignore-scripts");
  });

  it("runs the preflight first, skips with exit 0 when not ready, and passes real failures on", () => {
    const testStep = stepContaining("npm run test:contract");
    expect(testStep.indexOf("preflight-cli")).toBeGreaterThan(-1);
    expect(testStep.indexOf("preflight-cli")).toBeLessThan(
      testStep.indexOf("npm run test:contract"),
    );
    expect(testStep).toMatch(/exit 0/);
  });

  it("writes nothing to the log except through the summary file", () => {
    expect(workflow).not.toMatch(/echo .*secrets\./);
    expect(workflow).not.toContain("set -x");
  });

  it("is a separate suite: npm test does not pick it up", () => {
    expect(unitConfig.test?.include).toEqual(["tests/**/*.test.ts"]);
    expect(contractConfig.test?.include).toEqual(["tests/contract/**/*.contract.ts"]);
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(scripts["test:contract"]).toBe("vitest run --config vitest.contract.config.ts");
    expect(scripts.test).toBe("vitest run");
  });

  it("the CI workflow never runs the contract suite", () => {
    expect(read(".github/workflows/ci.yml")).not.toContain("test:contract");
  });
});
