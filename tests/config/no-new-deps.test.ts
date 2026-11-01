import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M24 step 7 (plan §5, "no new dependency"): the sorted names of dependencies and devDependencies are the ones of main 28a3848 (M0-M23).
// Adding a package, for instance a CSV or PDF library, fails here and needs a plan change.
const EXPECTED = [
  "@anthropic-ai/sdk",
  "@playwright/test",
  "@sentry/nextjs",
  "@supabase/ssr",
  "@supabase/supabase-js",
  "@tailwindcss/postcss",
  "@testing-library/dom",
  "@testing-library/react",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@vitest/coverage-v8",
  "eslint",
  "eslint-config-next",
  "eslint-config-prettier",
  "fake-indexeddb",
  "jsdom",
  "next",
  "prettier",
  "react",
  "react-dom",
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

  it("are exactly the ones of main 28a3848", () => {
    expect([...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)].sort()).toEqual(
      [...EXPECTED].sort(),
    );
  });

  it("the list is sorted and has no duplicate (self-test)", () => {
    expect(new Set(EXPECTED).size).toBe(EXPECTED.length);
  });
});
