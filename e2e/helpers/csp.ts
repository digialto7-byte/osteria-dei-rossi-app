import type { BrowserContext, Page } from "@playwright/test";

// M25 step 4 (ADR-028): every page runs under a nonce CSP, so a spec can prove that nothing was blocked. The collector listens
// for the browser's own `securitypolicyviolation` event in every frame of the context (an init script, reported through a binding
// so a navigation cannot lose a line) and for console lines that name the policy. Each line holds the violated directive and
// where it came from, never a nonce or a header.
const BINDING = "__reportCspViolation";
const CONSOLE_LINE = /Content Security Policy/i;

export type CspCollector = { readonly violations: string[] };

export async function collectCspViolations(context: BrowserContext): Promise<CspCollector> {
  const violations: string[] = [];
  const watch = (page: Page) =>
    page.on("console", (message) => {
      if (CONSOLE_LINE.test(message.text())) {
        violations.push(`console: ${message.text().replace(/'nonce-[^']*'/g, "'nonce-…'")}`);
      }
    });

  await context.exposeBinding(BINDING, (_source, line: string) => {
    violations.push(line);
  });
  await context.addInitScript((binding) => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as Record<string, (line: string) => void>)[binding];
      let blocked = event.blockedURI;
      try {
        const url = new URL(blocked);
        blocked = `${url.origin}${url.pathname}`;
      } catch {
        // "inline", "eval" and the like are not URLs: kept as they are.
      }
      report?.(`${event.violatedDirective} blocked ${blocked}`);
    });
  }, BINDING);

  for (const page of context.pages()) watch(page);
  context.on("page", watch);
  return { violations };
}

/** The `<script` opening tags of an HTML text. */
export function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/gi) ?? [];
}
