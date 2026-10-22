import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMessageKey, messages, t } from "@/lib/i18n";
import { isLocale } from "@/lib/i18n/locale";
import { INVOICE_STATUSES } from "@/server/invoices/invoices";
import { IMPORT_ERROR_CODES } from "@/server/master/import";

describe("i18n catalogues", () => {
  it("Italian is the default locale", () => {
    expect(t("login.title")).toBe(messages.it["login.title"]);
  });

  it("English has exactly the same keys as Italian", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.it).sort());
  });

  it("no message is empty", () => {
    for (const catalogue of Object.values(messages)) {
      for (const text of Object.values(catalogue)) expect(text.trim()).not.toBe("");
    }
  });

  it("interpolates named values", () => {
    expect(t("home.greeting", { name: "Demo" }, "en")).toBe("Hello, Demo");
  });

  it("leaves unknown placeholders visible instead of printing undefined", () => {
    expect(t("home.greeting", {}, "en")).toBe("Hello, {name}");
  });

  it("isMessageKey tells catalogue keys from arbitrary strings", () => {
    expect(isMessageKey("importError.invalid_vat_number")).toBe(true);
    expect(isMessageKey("importError.something_new")).toBe(false);
  });

  it("every import error code the server can send has an Italian text", () => {
    for (const code of IMPORT_ERROR_CODES) {
      expect(isMessageKey(`importError.${code}`), code).toBe(true);
    }
  });

  it("every invoice status has a label in both languages", () => {
    for (const status of INVOICE_STATUSES) {
      const key = `invoiceStatus.${status}`;
      expect(isMessageKey(key), status).toBe(true);
    }
    expect(t("invoiceStatus.received")).toBe("Ricevuta");
    expect(t("invoiceStatus.extracting")).toBe("In lettura");
    expect(t("invoiceStatus.extraction_failed")).toBe("Lettura non riuscita");
    expect(t("invoiceStatus.review")).toBe("Da controllare");
    expect(t("invoiceStatus.approved")).toBe("Approvata");
    expect(t("invoiceStatus.rejected")).toBe("Rifiutata");
    expect(t("invoiceStatus.duplicate")).toBe("Duplicata");
  });

  it("every extraction error and gate flag the database allows has an Italian text", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261022120000_invoice_extraction.sql"),
      "utf8",
    );
    // The gate flag list was extended by a later migration; the newest definition wins.
    const flagSql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261022120300_gate_flag_supplier_is_buyer.sql"),
      "utf8",
    );
    const listAfter = (constraint: string, source = sql) =>
      [
        ...source
          .slice(source.indexOf(constraint))
          .split(")")[0]!
          .matchAll(/'([a-z_]+)'/g),
      ].map((match) => match[1]!);
    const codes = listAfter("invoice_extraction_error_ck");
    const flags = listAfter("add constraint invoice_gate_flags_ck", flagSql);
    expect(codes).toHaveLength(12);
    expect(flags).toEqual(["total_mismatch", "low_confidence", "supplier_is_buyer"]);
    for (const code of codes) expect(isMessageKey(`extractionError.${code}`), code).toBe(true);
    for (const flag of flags) expect(isMessageKey(`gateFlag.${flag}`), flag).toBe(true);
    expect(t("gateFlag.total_mismatch")).toBe("Il totale non corrisponde");
    expect(t("gateFlag.low_confidence")).toBe("Da verificare: lettura incerta");
    expect(t("gateFlag.supplier_is_buyer")).toBe(
      "Partita IVA del fornitore uguale alla vostra: da verificare",
    );
    expect(t("extractionError.provider_unavailable")).toBe(
      "Lettura non riuscita: il servizio non risponde",
    );
  });

  it("lease_expired does not tell the owner to upload again (the failed row stays, so it would duplicate)", () => {
    expect(t("extractionError.lease_expired")).toBe(
      "La lettura automatica non è riuscita. Si potrà riprovare dalla revisione.",
    );
    expect(t("extractionError.lease_expired", {}, "en")).toBe(
      "Automatic reading did not work. It can be retried from the review.",
    );
    for (const locale of ["it", "en"] as const) {
      expect(t("extractionError.lease_expired", {}, locale)).not.toMatch(
        /ricaric|upload|re-?send/i,
      );
    }
  });

  it("recognises only supported locales", () => {
    expect(isLocale("it")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
