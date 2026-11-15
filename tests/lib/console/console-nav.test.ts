import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSOLE_SECTIONS, currentSection, venueHref } from "@/lib/console/console-nav";
import { t } from "@/lib/i18n";

const ID = "3f2c9a10-5b7d-4e1a-9c33-0a1b2c3d4e5f";

describe("currentSection", () => {
  it("«/locali/<uuid>» is locali", () => {
    expect(currentSection(`/locali/${ID}`)).toBe("locali");
  });
  it("maps the visible paths", () => {
    expect(currentSection("/")).toBe("locali");
    expect(currentSection("/registro")).toBe("registro");
    expect(currentSection("/registro?x=1")).toBe("registro");
    expect(currentSection("/avvisi")).toBe("avvisi");
  });
  it("is null elsewhere, and the visible path is not /console/…", () => {
    expect(currentSection("/login")).toBeNull();
    expect(currentSection("/login/codice")).toBeNull();
    expect(currentSection("/registrox")).toBeNull();
    expect(currentSection("/console/registro")).toBeNull();
  });
});

describe("CONSOLE_SECTIONS and venueHref", () => {
  it("lists the three sections in order with visible hrefs and labels", () => {
    expect(CONSOLE_SECTIONS.map((s) => [s.key, s.href, t(s.labelKey)])).toEqual([
      ["locali", "/", "Locali"],
      ["registro", "/registro", "Registro"],
      ["avvisi", "/avvisi", "Avvisi"],
    ]);
  });
  it("links a venue by its visible path", () => {
    expect(venueHref(ID)).toBe(`/locali/${ID}`);
  });
});

function sources(dir: string): string[] {
  let out: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out = out.concat(sources(path));
      else if (/\.(ts|tsx)$/.test(name)) out.push(path);
    }
  } catch {
    // a folder that does not exist yet has no sources
  }
  return out;
}

describe("visible paths only", () => {
  it("no href in the console tree starts with /console", () => {
    const roots = ["src/lib/console", "src/components/console", "src/app/(platform)"];
    const hits: string[] = [];
    for (const file of roots.flatMap((r) => sources(join(process.cwd(), r)))) {
      const text = readFileSync(file, "utf8");
      if (/href\s*[=:]\s*\{?\s*[`"']\/console(?![\w-])/.test(text)) hits.push(file);
      if (/(?:Link|navigateTo|replace|push)\(?[^)]*[`"']\/console\//.test(text)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
