import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { it as italian } from "@/lib/i18n/messages/it";

// M25b step 17 (plan §5): the design doc and the ADRs say what the build does. The app-shell row names the six groups and Altro; the §8
// M25b line exists and every Italian label it quotes in «…» is a real message value; ADR-020 points to ADR-030.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const DESIGN = read("docs/design/ui-foundation.md");
const lines = DESIGN.split("\n");
const shellRow = lines.find((line) => line.startsWith("| App shell"));
const m25bLine = lines.find((line) => line.startsWith("**M25b"));

describe("docs/design/ui-foundation.md", () => {
  it("has an app-shell row that names the six groups and Altro, and not Acquisti", () => {
    expect(shellRow).toBeDefined();
    for (const word of ["Home", "Gestione", "Cucina", "Sala", "Anagrafica", "Registro", "Altro"]) {
      expect(shellRow, word).toContain(word);
    }
    expect(shellRow).not.toContain("Acquisti");
    expect(shellRow).toContain("ADR-030");
  });

  it("has a §8 M25b line that quotes only labels the app has", () => {
    expect(m25bLine).toBeDefined();
    const quoted = [...m25bLine!.matchAll(/«([^»]+)»/g)].map((m) => m[1]!);
    for (const label of [
      "Home",
      "Altro",
      "Dettagli",
      "Azzera filtri",
      "Tutti gli avvisi",
      "Sicurezza",
      "Attività",
    ]) {
      expect(quoted, label).toContain(label);
    }
    const values = new Set<string>(Object.values(italian));
    for (const label of quoted) expect(values.has(label), `«${label}» is in it.ts`).toBe(true);
  });
});

describe("the ADRs", () => {
  it("ADR-020's status line says ADR-030 supersedes it", () => {
    const status = read("docs/adr/adr-020-app-shell-navigation.md")
      .split("\n")
      .find((line) => line.startsWith("- **Status:**"));
    expect(status).toContain("ADR-030");
    expect(status).toMatch(/superseded/i);
  });

  it("ADR-030 exists and is accepted", () => {
    const status = read("docs/adr/adr-030-navigation-by-job-home-first.md")
      .split("\n")
      .find((line) => line.startsWith("- **Status:**"));
    expect(status).toMatch(/accepted/i);
  });
});
