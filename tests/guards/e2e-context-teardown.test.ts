import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// E2E teardown guard. Chromium's headless shell segfaulted (run 43682851653, run 43696251007) when a spec closed one
// browser context in the middle of a test while another context of the same browser lived on and was used next
// (e2e/sell-by-weight.spec.ts closed the chef's context, and the waiter's next goto died).
//
// Rule: a browser context may be closed only as the last thing its block does. A `.close()` of a context (a receiver
// named `...context`, `relaunched` or `warmContext`) must be followed, in its block, only by other context closes; a
// close inside a `finally` counts for the `try` statement, which must itself end its block. A close that has to
// happen late is deferred: register the context and close it in `test.afterEach` (see closeContexts in
// e2e/helpers/order-ui.ts). The check is structural (TypeScript AST), so it sees a close that is followed by more
// statements, not whether a later statement happens to use another context: it errs on the safe side.

const E2E_DIR = join(__dirname, "..", "..", "e2e");

// Files that own their browser (chromium.launch in the test), so no other test shares it.
const OWN_BROWSER = new Set(["perf/dashboard-4g.spec.ts"]);

const CONTEXT_RECEIVER = /(?:^|\.)(?:\w*[cC]ontext|relaunched)$/;

function closedContextIn(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "close" &&
      n.arguments.length === 0 &&
      CONTEXT_RECEIVER.test(n.expression.expression.getText())
    ) {
      found = true;
    }
    // A closure (the test callback itself) is its own scope: its closes are judged there.
    if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** The statement is nothing but context closes (`await a.context.close();`, `await Promise.all([a.close(), b.close()]);`). */
function isCloseStatement(statement: ts.Statement): boolean {
  return ts.isExpressionStatement(statement) && closedContextIn(statement);
}

/** True when nothing but context closes follows `statement` in its block, and the same holds for the enclosing try/if. */
function endsItsBlock(statement: ts.Node): boolean {
  const parent = statement.parent;
  if (!parent) return true;
  if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseClause(parent)) {
    const siblings = parent.statements;
    const after = siblings.slice(siblings.indexOf(statement as ts.Statement) + 1);
    if (!after.every(isCloseStatement)) return false;
    // The block of a function (test body, afterEach, helper) ends the story; any other block belongs to a statement.
    const owner = parent.parent;
    if (!owner || ts.isFunctionLike(owner) || ts.isSourceFile(owner)) return true;
    return endsItsBlock(owner);
  }
  return endsItsBlock(parent);
}

export function midTestCloses(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && isCloseStatement(node) && !endsItsBlock(node)) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart());
      problems.push(`${fileName}:${line + 1}: ${node.getText().slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return specFiles(path);
    return name.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("e2e specs close a browser context only at the end of its block", () => {
  it("flags a close that is followed by more steps (the sell-by-weight crash)", () => {
    const source = `
      test("x", async ({ browser }) => {
        const chef = await newContext(browser);
        const waiter = await newContext(browser);
        await chef.context.close();
        await waiter.page.goto("/");
      });`;
    expect(midTestCloses("fake.spec.ts", source)).toHaveLength(1);
  });

  it("flags a close in a finally whose try is followed by more steps", () => {
    const source = `
      test("x", async ({ browser, page }) => {
        const owner = await newContext(browser);
        try {
          await owner.page.goto("/");
        } finally {
          await owner.context.close();
        }
        await page.goto("/");
      });`;
    expect(midTestCloses("fake.spec.ts", source)).toHaveLength(1);
  });

  it("accepts closes that end the test, a finally that ends it, and a deferred afterEach", () => {
    const source = `
      test("x", async ({ browser }) => {
        const a = await newContext(browser);
        const b = await newContext(browser);
        try {
          await a.page.goto("/");
        } finally {
          await b.context.close();
          await a.context.close();
        }
      });
      test("y", async ({ browser }) => {
        const a = await newContext(browser);
        await Promise.all([a.context.close()]);
      });
      test.afterEach(async () => {
        for (const context of opened.splice(0).reverse()) await context.close();
      });`;
    expect(midTestCloses("fake.spec.ts", source)).toEqual([]);
  });

  it("holds for every spec in e2e/", () => {
    const problems = specFiles(E2E_DIR)
      .filter((path) => !OWN_BROWSER.has(relative(E2E_DIR, path)))
      .flatMap((path) =>
        midTestCloses(relative(join(E2E_DIR, ".."), path), readFileSync(path, "utf8")),
      );
    expect(problems).toEqual([]);
  });
});
