import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// E2E teardown guard. Chromium's headless shell segfaulted (run 43682851653, run 43696251007) after a spec closed one
// browser context in the middle of a test while another context of the same browser lived on and was used next
// (e2e/sell-by-weight.spec.ts closed the chef's context, and the waiter's next goto died).
//
// What it checks, on every e2e/**/*.spec.ts (a TypeScript AST scan, no type checker):
//  1. Which calls are context closes: `X.close()` where X is a context by origin or by name. By origin: a variable assigned from
//     `browser.newContext(...)`, from the `newContext(...)` or `newPhone(...)` helper (and `holder.context` of that result), or a
//     name bound by destructuring `{ context }` / `{ context: ctx }` of such a result; also `.context` and `.context()` of
//     anything. By name: an identifier ending in `context` or called `relaunched`. Origins are tracked per file, not per scope.
//  2. Where a close may sit: only directly in the test callback (`test(...)`, `test.only/skip/fixme/fail/slow`) or in a
//     hook callback (`test.beforeAll/beforeEach/afterEach/afterAll`). A close in any other function (a helper, a `test.step`
//     callback, an arrow passed elsewhere) is flagged, because the guard cannot see where that function is called; the helper
//     must register its context and let `test.afterEach` close it (closeContexts in e2e/helpers/order-ui.ts). ALLOWED_FUNCTIONS
//     lists the exceptions, each with a reason; it is empty.
//  3. In a test or hook callback, the close must be the last thing its block does: only other context closes may follow it,
//     and a close inside a `try`/`finally`, `if` or loop counts for that statement, which must itself end its block.
//
// What it cannot do: tell whether a later statement really uses another context (a close that ends its block but runs
// while another context is still needed is not seen, and a flagged close may be harmless); follow a context handed to a
// function or stored in an array and closed under another name (e.g. `for (const c of opened) await c.close()`); or see
// closes in files that are not *.spec.ts. Specs that launch their own browser are listed in OWN_BROWSER.

const E2E_DIR = process.env.E2E_GUARD_DIR ?? join(__dirname, "..", "..", "e2e");

// Specs that own their browser (chromium.launch in the test), so no other test shares it.
const OWN_BROWSER = new Set(["perf/dashboard-4g.spec.ts"]);

// "<file relative to e2e/>:<function name>" -> reason. Empty on purpose.
const ALLOWED_FUNCTIONS = new Map<string, string>();

const CONTEXT_NAME = /(?:^|\.)(?:\w*[cC]ontext|relaunched)$/;
const CONTEXT_FACTORIES = new Set(["newContext", "newPhone"]);
const TEST_CALLEE = /^test(?:\.(?:only|skip|fixme|fail|slow))*$/;
const HOOK_CALLEE = /^test\.(?:beforeAll|beforeEach|afterEach|afterAll)$/;

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current))
    current = current.expression;
  return current;
}

/** "context" for a context itself (browser.newContext), "holder" for the { context, page } result of the helpers. */
function originOf(initializer: ts.Expression): "context" | "holder" | null {
  const call = unwrap(initializer);
  if (!ts.isCallExpression(call)) return null;
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "newContext") return "context";
  if (ts.isIdentifier(callee) && CONTEXT_FACTORIES.has(callee.text)) return "holder";
  return null;
}

function trackedNames(file: ts.SourceFile): { contexts: Set<string>; holders: Set<string> } {
  const contexts = new Set<string>();
  const holders = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const origin = originOf(node.initializer);
      if (origin && ts.isIdentifier(node.name))
        (origin === "context" ? contexts : holders).add(node.name.text);
      if (origin === "holder" && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(property) &&
            property.text === "context" &&
            ts.isIdentifier(element.name)
          ) {
            contexts.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { contexts, holders };
}

function isContextExpression(
  expression: ts.Expression,
  tracked: { contexts: Set<string>; holders: Set<string> },
): boolean {
  const text = expression.getText();
  if (ts.isIdentifier(expression) && tracked.contexts.has(expression.text)) return true;
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === "context") return true;
  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "context"
  ) {
    return true;
  }
  return CONTEXT_NAME.test(text);
}

function contextCloses(
  root: ts.Node,
  tracked: Parameters<typeof isContextExpression>[1],
): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "close" &&
      n.arguments.length === 0 &&
      isContextExpression(n.expression.expression, tracked)
    ) {
      found.push(n);
    }
    // A closure is its own scope: its closes are judged there, not as part of this statement.
    if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  for (let n = node.parent; n; n = n.parent)
    if (ts.isFunctionLike(n)) return n as ts.FunctionLikeDeclaration;
  return null;
}

function functionName(fn: ts.FunctionLikeDeclaration): string {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return "<anonymous>";
}

/** A test or hook callback of Playwright (`test("...", async () => {})`, `test.afterEach(...)`). */
function isTestOrHookCallback(fn: ts.FunctionLikeDeclaration): boolean {
  const call = fn.parent;
  if (
    !call ||
    !ts.isCallExpression(call) ||
    !call.arguments.includes(fn as unknown as ts.Expression)
  )
    return false;
  const callee = call.expression.getText();
  return TEST_CALLEE.test(callee) || HOOK_CALLEE.test(callee);
}

/** True when nothing but context closes follows `statement` in its block, and the same holds for the enclosing try/if/loop. */
function endsItsBlock(
  statement: ts.Node,
  tracked: Parameters<typeof isContextExpression>[1],
): boolean {
  const parent = statement.parent;
  if (!parent) return true;
  if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseClause(parent)) {
    const siblings = parent.statements;
    const after = siblings.slice(siblings.indexOf(statement as ts.Statement) + 1);
    const onlyCloses = (s: ts.Statement) =>
      ts.isExpressionStatement(s) && contextCloses(s, tracked).length > 0;
    if (!after.every(onlyCloses)) return false;
    const owner = parent.parent;
    if (!owner || ts.isFunctionLike(owner) || ts.isSourceFile(owner)) return true;
    return endsItsBlock(owner, tracked);
  }
  return endsItsBlock(parent, tracked);
}

export function contextCloseProblems(
  fileName: string,
  source: string,
  allowed = ALLOWED_FUNCTIONS,
): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const tracked = trackedNames(file);
  const problems: string[] = [];
  const report = (node: ts.Node, why: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    problems.push(`${fileName}:${line + 1}: ${why}: ${node.getText().slice(0, 70)}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && contextCloses(node, tracked).length > 0) {
      const fn = enclosingFunction(node);
      if (!fn || !isTestOrHookCallback(fn)) {
        if (!allowed.has(`${fileName}:${fn ? functionName(fn) : "<top level>"}`)) {
          report(
            node,
            "context closed outside a test or hook callback (a helper, test.step or other function)",
          );
        }
      } else if (!endsItsBlock(node, tracked)) {
        report(node, "context closed before the end of its block");
      }
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

describe("e2e specs close a browser context only at the end of a test or hook block", () => {
  it("flags a close that is followed by more steps (the sell-by-weight crash)", () => {
    const source = `
      test("x", async ({ browser }) => {
        const chef = await newContext(browser);
        const waiter = await newContext(browser);
        await chef.context.close();
        await waiter.page.goto("/");
      });`;
    expect(contextCloseProblems("fake.spec.ts", source)).toHaveLength(1);
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
    expect(contextCloseProblems("fake.spec.ts", source)).toHaveLength(1);
  });

  it("flags the old ownerPushes shape: a try/finally close at the end of a helper the test calls mid-test", () => {
    const source = `
      async function ownerPushes(browser, use) {
        const owner = await newContext(browser, use);
        try {
          await owner.page.request.post("/api/menu/1/push");
        } finally {
          await owner.context.close();
        }
      }
      test("x", async ({ browser, page }, testInfo) => {
        await ownerPushes(browser, testInfo.project.use);
        await page.goto("/spingere");
      });`;
    const problems = contextCloseProblems("fake.spec.ts", source);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("outside a test or hook callback");
  });

  it("flags a close inside a test.step callback, even a last one", () => {
    const source = `
      test("x", async ({ browser }) => {
        const chef = await newContext(browser);
        await test.step("chef", async () => {
          await chef.context.close();
        });
        await test.step("more", async () => {});
      });`;
    expect(contextCloseProblems("fake.spec.ts", source)).toHaveLength(1);
  });

  it("flags a destructured or renamed context closed mid-test", () => {
    const source = `
      test("x", async ({ browser, page }) => {
        const { context: ctx } = await newContext(browser);
        const raw = await browser.newContext();
        await ctx.close();
        await raw.close();
        await page.goto("/");
      });`;
    expect(contextCloseProblems("fake.spec.ts", source)).toHaveLength(2);
  });

  it("accepts a function listed in the allowlist, with its reason", () => {
    const source = `
      async function drop(browser) {
        const c = await browser.newContext();
        await c.close();
      }`;
    expect(contextCloseProblems("fake.spec.ts", source)).toHaveLength(1);
    expect(
      contextCloseProblems("fake.spec.ts", source, new Map([["fake.spec.ts:drop", "a reason"]])),
    ).toEqual([]);
  });

  it("accepts closes that end the test or a hook, a finally that ends it, and a deferred afterEach", () => {
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
        const { context: ctx } = await newContext(browser);
        await Promise.all([ctx.close()]);
      });
      test.beforeAll(async ({ browser }) => {
        const { context, page } = await newContext(browser);
        try {
          await page.goto("/");
        } finally {
          await context.close();
        }
      });
      test.afterEach(async () => {
        for (const context of opened.splice(0).reverse()) await context.close();
      });`;
    expect(contextCloseProblems("fake.spec.ts", source)).toEqual([]);
  });

  it("holds for every spec in e2e/", () => {
    const problems = specFiles(E2E_DIR)
      .filter((path) => !OWN_BROWSER.has(relative(E2E_DIR, path)))
      .flatMap((path) => contextCloseProblems(relative(E2E_DIR, path), readFileSync(path, "utf8")));
    expect(problems).toEqual([]);
  });
});
