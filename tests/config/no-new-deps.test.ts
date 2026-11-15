import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M24 step 7 (plan §5, "no new dependency"): the sorted names of dependencies and devDependencies are the ones of main 28a3848 (M0-M23).
// Adding a package, for instance a CSV or PDF library, fails here and needs a plan change.
// P2-7 S9 adds saxes 6.0.0 on purpose (plan docs/plans/2026-11-14-p2-7-xml-invoice-upload.md D-X12): the XML reader of the e-invoice import. It was
// already in the lockfile through jsdom; it is now a direct dependency.
// SP3 adds js-yaml 4.3.2 and @types/js-yaml 4.0.9 on purpose (lead decision, round 3 of PR #140): the workflow guard tests parse the YAML instead of searching its
// text. js-yaml was already in the lockfile through eslint; both are devDependencies, pinned exactly.
const EXPECTED = [
  "@anthropic-ai/sdk",
  "@playwright/test",
  "@sentry/nextjs",
  "@supabase/ssr",
  "@supabase/supabase-js",
  "@tailwindcss/postcss",
  "@testing-library/dom",
  "@testing-library/react",
  "@types/js-yaml",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@vitest/coverage-v8",
  "eslint",
  "eslint-config-next",
  "eslint-config-prettier",
  "fake-indexeddb",
  "js-yaml",
  "jsdom",
  "next",
  "prettier",
  "react",
  "react-dom",
  "saxes",
  "supabase",
  "tailwindcss",
  "tsx",
  "typescript",
  "vitest",
  "zod",
];

describe("dependencies", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("are exactly the ones of main 28a3848 plus saxes (P2-7) and js-yaml with its types (SP3)", () => {
    expect([...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)].sort()).toEqual(
      [...EXPECTED].sort(),
    );
  });

  it("the list is sorted and has no duplicate (self-test)", () => {
    expect(new Set(EXPECTED).size).toBe(EXPECTED.length);
  });
});

describe("js-yaml (SP3, a dev-only workflow parser)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("is a devDependency pinned exactly, with its types, and not a runtime dependency", () => {
    expect(pkg.devDependencies["js-yaml"]).toBe("4.3.2");
    expect(pkg.devDependencies["@types/js-yaml"]).toBe("4.0.9");
    expect(pkg.dependencies["js-yaml"]).toBeUndefined();
  });
});

describe("saxes (P2-7 D-X12)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(
    readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
  ) as {
    packages: Record<string, { version: string; dev?: boolean }>;
  };

  it("is a runtime dependency at the exact locked version", () => {
    expect(pkg.dependencies["saxes"]).toBe("6.0.0");
    expect(lock.packages["node_modules/saxes"]?.version).toBe("6.0.0");
    expect(lock.packages["node_modules/saxes"]?.dev).toBeUndefined();
    expect(lock.packages["node_modules/xmlchars"]?.dev).toBeUndefined();
  });
});
