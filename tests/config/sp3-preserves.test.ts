import { readFileSync } from "node:fs";
import { PLATFORM_AUDIT_ACTIONS, PLATFORM_NOTICE_KINDS } from "@/lib/platform/codes";
import { describe, expect, it } from "vitest";

// SP3 guards (docs/plans sp3 sections 3.8.3, 3.11 and 5). Created by SP3 step 21; every later SP3 step extends it.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("sp3-preserves: the wordmark stays a constant until SP9 (plan 3.8.3)", () => {
  it("VENUE_LAYER_DEFAULT still takes its name from t('venue.name')", () => {
    expect(read("src/lib/design/venue-layer.ts")).toMatch(
      /export const VENUE_LAYER_DEFAULT: Venue = \{ name: t\("venue\.name"\),/,
    );
  });

  it("venue.name is unchanged in it.ts and en.ts", () => {
    expect(read("src/lib/i18n/messages/it.ts")).toContain('"venue.name": "Osteria Dei Rossi",');
    expect(read("src/lib/i18n/messages/en.ts")).toContain('"venue.name": "Osteria Dei Rossi",');
  });

  it("the console band is the constant «Costì · Console» and gives the band no venue (HeaderBand without `venue`) and reads no name", () => {
    const band = read("src/components/console/console-band.tsx");
    expect(band).toContain("Console");
    expect(band).not.toMatch(/venue=|VENUE_LAYER|BrandLink|BrandTitle|BrandWordmark|t\("venue\./);
    expect(band).not.toMatch(/\bprops\b|tenant|venue\.name/i);
  });

  it("no SP3 console file hands a tenant name to HeaderBand, BrandLink or VENUE_LAYER_DEFAULT", () => {
    for (const file of ["src/components/console/console-band.tsx"]) {
      expect(read(file), file).not.toMatch(/VENUE_LAYER_DEFAULT|BrandLink|BrandTitle/);
    }
  });
});

// Step 6 adds the files of the platform-ops workflow; the migration-list and code-list-equality guards join with the migrations of the stacked steps.
const SP3_FILES = [
  "src/lib/platform/codes.ts",
  "src/lib/platform/api.ts",
  "src/components/console/console-band.tsx",
  ".github/workflows/platform-ops.yml",
  "tests/config/platform-ops-workflow.test.ts",
];

describe("sp3-preserves: naming (plan section 5)", () => {
  it("no SP3 file mentions the spike's sp0_ or sp0. names", () => {
    for (const file of SP3_FILES) expect(read(file), file).not.toMatch(/sp0[_.]/);
  });

  it("no code in the platform code lists is named for cost, margin, price or service", () => {
    for (const code of [...PLATFORM_AUDIT_ACTIONS, ...PLATFORM_NOTICE_KINDS])
      expect(code).not.toMatch(/cost|margin|price|service/);
  });

  it("the platform-ops workflow is the only SP3 file that names the secret key", () => {
    for (const file of SP3_FILES.filter((f) => !f.includes("platform-ops")))
      expect(read(file), file).not.toContain("SUPABASE_SECRET_KEY");
  });
});
