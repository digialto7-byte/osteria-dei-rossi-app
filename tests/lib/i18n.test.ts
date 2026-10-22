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

  it("recognises only supported locales", () => {
    expect(isLocale("it")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
