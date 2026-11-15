import { describe, expect, it } from "vitest";
import { PLATFORM_AUDIT_ACTIONS } from "@/lib/platform/codes";
import {
  AUDIT_SENTENCE_KEYS,
  auditActionOptions,
  auditDetailEntries,
  auditListMeta,
  auditPlace,
  auditRequestPath,
  auditSentence,
  originLabel,
  parseRegistroQuery,
  registroHref,
} from "@/lib/console/audit-view";

const TEN = [
  "platform_admin.bootstrapped",
  "platform_admin.factor_enrolled",
  "console.entered",
  "console.left",
  "console.tenant_opened",
  "notice.created",
  "notice.tenant_notified",
  "script.create_tenant",
  "script.mfa_reset",
  "script.set_mfa_enforcement",
];
const TODAY = "2026-11-15";
const DEFAULTS = { dal: "2026-10-17", al: "2026-11-15" };
const ID = "3f2c9a10-5b7d-4e1a-9c33-0a1b2c3d4e5f";

describe("auditSentence", () => {
  it("«console.entered» is «Accesso alla console»", () => {
    expect(auditSentence("console.entered")).toBe("Accesso alla console");
  });
  it("has a sentence for each of the ten codes, in the order of the code list", () => {
    expect(Object.keys(AUDIT_SENTENCE_KEYS)).toEqual(TEN);
    for (const code of TEN) expect(auditSentence(code), code).toBeTruthy();
  });
  it("is null for an unknown code, so the screen shows the code", () => {
    expect(auditSentence("something.new")).toBeNull();
    expect(auditSentence("toString")).toBeNull();
  });
});

describe("originLabel and auditPlace", () => {
  it("names the origins and passes an unknown one through", () => {
    expect(originLabel("console")).toBe("Console");
    expect(originLabel("script")).toBe("Script");
    expect(originLabel("cron")).toBe("cron");
  });
  it("shows the venue name", () => {
    expect(auditPlace({ tenantId: ID, tenantName: "Osteria Demo A" })).toBe("Osteria Demo A");
  });
  it("shows a dash for a platform-wide row", () => {
    expect(auditPlace({ tenantId: null, tenantName: null })).toBe("—");
  });
  it("shows «Locale cancellato» and the first 8 characters of the id for an erased venue", () => {
    expect(auditPlace({ tenantId: ID, tenantName: null })).toBe("Locale cancellato 3f2c9a10");
  });
});

describe("auditDetailEntries", () => {
  it("sorts by key and shows a dash for null", () => {
    expect(auditDetailEntries({ version: 3, ok: true, factor: null, a: "x" })).toEqual([
      ["a", "x"],
      ["factor", "—"],
      ["ok", "true"],
      ["version", "3"],
    ]);
  });
  it("is empty for no detail", () => {
    expect(auditDetailEntries({})).toEqual([]);
  });
});

describe("auditRequestPath", () => {
  it("always sends dal and al", () => {
    expect(auditRequestPath({ ...DEFAULTS, locale: null, azione: null }, null)).toBe(
      "/api/platform/audit?dal=2026-10-17&al=2026-11-15",
    );
  });
  it("adds only the filters that are set, prima as an integer", () => {
    expect(auditRequestPath({ ...DEFAULTS, locale: ID, azione: "console.entered" }, 120)).toBe(
      `/api/platform/audit?dal=2026-10-17&al=2026-11-15&locale=${ID}&azione=console.entered&prima=120`,
    );
  });
  it("refuses a prima that is not an integer", () => {
    expect(() => auditRequestPath({ ...DEFAULTS, locale: null, azione: null }, 1.5)).toThrow(
      RangeError,
    );
  });
});

describe("parseRegistroQuery", () => {
  const known = TEN;
  it("defaults the range when the dates are missing", () => {
    expect(parseRegistroQuery(new URLSearchParams(""), TODAY, known)).toEqual({
      ...DEFAULTS,
      locale: null,
      azione: null,
    });
  });
  it("defaults the range when one date is missing, invalid, reversed or too wide", () => {
    for (const s of [
      "dal=2026-11-01",
      "dal=2026-02-30&al=2026-03-01",
      "dal=2026-11-10&al=2026-11-01",
      "dal=2024-01-01&al=2026-11-01",
    ]) {
      expect(parseRegistroQuery(new URLSearchParams(s), TODAY, known), s).toMatchObject(DEFAULTS);
    }
  });
  it("keeps a good range", () => {
    expect(
      parseRegistroQuery(new URLSearchParams("dal=2026-11-01&al=2026-11-10"), TODAY, known),
    ).toMatchObject({
      dal: "2026-11-01",
      al: "2026-11-10",
    });
  });
  it("reads locale (uuid only) and azione (known only)", () => {
    expect(
      parseRegistroQuery(new URLSearchParams(`locale=${ID}&azione=console.left`), TODAY, known),
    ).toMatchObject({
      locale: ID,
      azione: "console.left",
    });
    expect(
      parseRegistroQuery(new URLSearchParams("locale=abc&azione=drop.table"), TODAY, known),
    ).toMatchObject({
      locale: null,
      azione: null,
    });
  });
});

describe("registroHref", () => {
  it("leaves out default dates", () => {
    expect(registroHref({ ...DEFAULTS, locale: null, azione: null }, TODAY)).toBe("/registro");
  });
  it("keeps other dates and the filters", () => {
    expect(
      registroHref(
        { dal: "2026-11-01", al: "2026-11-10", locale: ID, azione: "console.left" },
        TODAY,
      ),
    ).toBe(`/registro?dal=2026-11-01&al=2026-11-10&locale=${ID}&azione=console.left`);
    expect(registroHref({ ...DEFAULTS, locale: ID, azione: null }, TODAY)).toBe(
      `/registro?locale=${ID}`,
    );
  });
});

describe("auditListMeta", () => {
  it("joins the instant, the place and the origin", () => {
    expect(
      auditListMeta({
        at: "2026-11-14T08:40:00Z",
        tenantId: ID,
        tenantName: "Osteria Demo A",
        origin: "console",
      }),
    ).toBe("14 nov 2026, 09:40 · Osteria Demo A · Console");
  });
});

describe("the sentence table is bound to the code list", () => {
  it("the keys of AUDIT_SENTENCE_KEYS equal PLATFORM_AUDIT_ACTIONS, in order", () => {
    expect(Object.keys(AUDIT_SENTENCE_KEYS)).toEqual([...PLATFORM_AUDIT_ACTIONS]);
  });

  it("every code of the list has a sentence", () => {
    for (const code of PLATFORM_AUDIT_ACTIONS) expect(auditSentence(code), code).not.toBeNull();
  });

  it("the Azione options are the code list's, in its order, each with its sentence", () => {
    expect(auditActionOptions().map((o) => o.value)).toEqual([...PLATFORM_AUDIT_ACTIONS]);
    expect(auditActionOptions()[2]).toEqual({
      value: "console.entered",
      label: "Accesso alla console",
    });
  });
});
