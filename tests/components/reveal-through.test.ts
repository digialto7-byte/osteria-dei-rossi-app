// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShellView } from "@/app/(owner)/app-shell";
import { PeriodPanel } from "@/app/(owner)/report/period-picker";
import type { MeState } from "@/components/use-me";
import { KPI_REPORT } from "../helpers/report-data";
import { SERVICES_REPORT } from "../helpers/services-data";

// The report's period tabpanel wraps the content under the picker. `.reveal > *` only reaches direct children of main, so globals.css has a
// matching rule for the children of a [data-reveal-through] box: the k-th child gets the delay that child (panel index + k - 1) of main gets,
// whatever the panel's position (the shell's section row, the heading and the picker come first, and vary by role).
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      data: path.startsWith("/api/reports/services") ? SERVICES_REPORT : KPI_REPORT,
    }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/use-me", () => ({
  useMe: () => ({
    status: "ok",
    me: {
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Titolare", role: "owner" },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    },
    retry: () => undefined,
  }),
}));

afterEach(cleanup);
const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selectors = "", body = ""]) => ({
  selectors: selectors.split(",").map((s) => s.trim()),
  body,
}));
const bodyOf = (selector: string) => {
  const rule = rules.find((r) => r.selectors.includes(selector));
  if (!rule) throw new Error(`no rule for ${selector}`);
  return rule.body;
};
const ms = (text: string | undefined) => Number(text);

/** The delay (ms) the `.reveal > :nth-child(n)` rules give the n-th child of main: 0 for the first, then a step per child, capped. */
function mainDelay(n: number): number {
  if (n === 1) return ms(/--reveal-delay:\s*(\d+)ms/.exec(bodyOf(".reveal > *"))?.[1]);
  const selector = n <= 7 ? `.reveal > :nth-child(${n})` : ".reveal > :nth-child(n + 8)";
  return ms(/--reveal-delay:\s*(\d+)ms/.exec(bodyOf(selector))?.[1]);
}

/** The delay (ms) the through rules give the k-th child of a panel that is the p-th child of main. */
function throughDelay(p: number, k: number): number {
  const selector =
    k === 1
      ? ".reveal > [data-reveal-through] > *"
      : k <= 7
        ? `.reveal > [data-reveal-through] > :nth-child(${k})`
        : ".reveal > [data-reveal-through] > :nth-child(n + 8)";
  const m = /animation-delay:\s*min\(calc\(var\(--reveal-delay\) \+ (\d+)ms\),\s*(\d+)ms\)/.exec(
    bodyOf(selector),
  );
  if (!m) throw new Error(`no delay formula in ${selector}`);
  return Math.min(mainDelay(p) + ms(m[1]), ms(m[2]));
}

describe("the rise through a wrapper box", () => {
  it("the panel carries the hook, collapses when empty, and renders no child nodes when empty", () => {
    const { container } = render(
      createElement(PeriodPanel, { periodo: "giorno" }, createElement("p", null, "x")),
    );
    const panel = container.firstElementChild!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.hasAttribute("data-reveal-through")).toBe(true);
    // Empty, it must not add the page's 1.5 rem gap (gap-6): a negative margin cancels it and the role stays exposed.
    expect(panel.className).toContain("empty:-mt-6");
    cleanup();
    expect(
      render(createElement(PeriodPanel, { periodo: "giorno" })).container.firstElementChild!
        .childNodes,
    ).toHaveLength(0);
  });

  it("the box has no animation of its own", () => {
    expect(bodyOf(".reveal > [data-reveal-through]")).toMatch(/animation:\s*none\s*;/);
  });

  it("for any panel position, its k-th child gets the delay of child (position + k - 1) of main", () => {
    for (let p = 1; p <= 10; p += 1) {
      for (let k = 1; k <= 12; k += 1) {
        expect(throughDelay(p, k), `panel ${p}, child ${k}`).toBe(mainDelay(p + k - 1));
      }
    }
  });

  const OWNER: MeState = {
    status: "ok",
    me: {
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Titolare", role: "owner" },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    },
  };
  const SIGNED_OUT: MeState = { status: "signedOut", me: null };

  // The real page in the real layout and shell: the panel's index among main's children is counted, not assumed.
  it.each([
    ["a role with a section row", OWNER],
    ["no section row", SIGNED_OUT],
  ] as const)(
    "on the real report page with %s, each child gets its sibling's delay",
    async (_, state) => {
      const { default: ReportPage } = await import("@/app/(owner)/report/page");
      render(
        createElement(AppShellView, { state, pathname: "/report" }, createElement(ReportPage)),
      );
      await screen.findByText("Questo periodo");
      const main = screen.getByRole("main");
      const panel = main.querySelector("[data-reveal-through]") as HTMLElement;
      const p = [...main.children].indexOf(panel) + 1;
      expect(p).toBeGreaterThan(3);
      // The CSV link, the KPI panel and the services panel.
      await waitFor(() => expect(panel.children.length).toBeGreaterThanOrEqual(3));
      [...panel.children].forEach((_child, index) => {
        expect(throughDelay(p, index + 1), `child ${index + 1}`).toBe(mainDelay(p + index));
      });
      // The two shells put the panel at different positions: the section row, heading and picker are counted, not assumed.
      expect(p).toBe(state === OWNER ? 5 : 4);
    },
  );
});
