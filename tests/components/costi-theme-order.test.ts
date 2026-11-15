import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The order guard (docs/plans/2026-11-14-ux-p2-design-system.md D5): while two themes coexist, the route groups move to Costì one step at a
// time, in the order of docs/ux/costi-design-system.md §11. `DONE` is the number of steps finished. For a finished step every root renders
// `CostiTheme` and its files no longer hand-write a definition list, a tablist or a display-font heading; a later step's roots do not
// mention `CostiTheme` yet. P2j deletes the marker and this guard.
const DONE = 1;

const OWNER = "src/app/(owner)";
const PUBLIC = "src/app/(public)";

/** `scan` is a directory or a file; `marker` are the files that must render `<CostiTheme />` once the step is done. */
interface Root {
  scan: string;
  marker: string[];
}
const dirRoot = (name: string): Root => ({
  scan: `${OWNER}/${name}`,
  marker: [`${OWNER}/${name}/layout.tsx`],
});

const RESKIN: Record<number, Root[]> = {
  1: [dirRoot("tavoli")],
  2: ["cucina", "produzione", "riordino", "margini"].map(dirRoot),
  3: [
    { scan: `${OWNER}/page.tsx`, marker: [`${OWNER}/page.tsx`] },
    ...["spingere", "altro", "avvisi"].map(dirRoot),
  ],
  4: ["fatture", "pagamenti"].map(dirRoot),
  5: ["magazzino", "tracciabilita"].map(dirRoot),
  6: ["chiusura", "prenotazioni", "report"].map(dirRoot),
  7: [
    "ricette",
    "costi",
    "anagrafiche",
    "personale",
    "registro",
    "impostazioni",
    "menu",
    "dispositivi",
    "doppia-verifica",
    "password",
    "sicurezza",
  ].map(dirRoot),
  8: [
    {
      scan: `${PUBLIC}/prenota`,
      marker: [`${PUBLIC}/prenota/[slug]/page.tsx`, `${PUBLIC}/prenota/[slug]/annulla/page.tsx`],
    },
  ],
};

/** Files that may keep `font-display` (docs plan §4.4): the components that define the type ramp and two display faces. */
const FONT_DISPLAY_ALLOWED = [
  "src/components/ui.tsx",
  "src/components/brand.tsx",
  `${PUBLIC}/login/login-screen.tsx`,
  `${OWNER}/cucina/ticket-card.tsx`,
];

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const filesOf = (path: string): string[] =>
  statSync(join(ROOT, path)).isDirectory()
    ? readdirSync(join(ROOT, path)).flatMap((name) => filesOf(`${path}/${name}`))
    : /\.(ts|tsx)$/.test(path)
      ? [path]
      : [];

describe("the Costì re-skin order guard", () => {
  it("DONE is a step that exists", () => {
    expect(Number.isInteger(DONE)).toBe(true);
    expect(DONE).toBeGreaterThanOrEqual(0);
    expect(DONE).toBeLessThanOrEqual(Object.keys(RESKIN).length);
  });

  it("every root in the table exists, so a typo cannot hide a route", () => {
    for (const roots of Object.values(RESKIN)) {
      for (const root of roots) expect(existsSync(join(ROOT, root.scan)), root.scan).toBe(true);
    }
  });

  for (const [step, roots] of Object.entries(RESKIN)) {
    const done = Number(step) <= DONE;
    describe(`step ${step} (${done ? "done" : "not yet"})`, () => {
      if (done) {
        it.each(roots.flatMap((r) => r.marker))("%s renders <CostiTheme />", (file) => {
          expect(read(file)).toContain("<CostiTheme />");
        });
        it.each(roots.flatMap((r) => filesOf(r.scan)))(
          "%s has no hand-made type or tabs",
          (file) => {
            const source = read(file);
            expect(source, "a <dl>: use FactList").not.toMatch(/<dl[\s>]/);
            expect(source, 'role="tablist": use SegmentedControl').not.toMatch(/role="tablist"/);
            if (!FONT_DISPLAY_ALLOWED.includes(file)) {
              expect(source, "font-display: use Heading or SubHeading").not.toContain(
                "font-display",
              );
            }
          },
        );
      } else {
        it.each(roots.flatMap((r) => filesOf(r.scan)))("%s does not mention CostiTheme", (file) => {
          expect(read(file)).not.toContain("CostiTheme");
        });
      }
    });
  }
});
