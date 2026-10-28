import { describe, expect, it } from "vitest";
import {
  auditActionWord,
  canCount,
  canReadAudit,
  canReadCountCosts,
  countStatusView,
  countTypeWord,
  differenceText,
  parseCountInput,
  formatCountEuro,
  AUDIT_ACTIONS,
} from "@/lib/counts/count-view";

describe("roles (mirror the routes)", () => {
  it("canCount: owner, admin and chef", () => {
    for (const role of ["owner", "admin", "chef"]) expect(canCount(role), role).toBe(true);
    for (const role of ["waiter", "", "guest"]) expect(canCount(role), role).toBe(false);
  });
  it("canReadCountCosts and canReadAudit: owner and admin only", () => {
    for (const fn of [canReadCountCosts, canReadAudit]) {
      expect(fn("owner")).toBe(true);
      expect(fn("admin")).toBe(true);
      for (const role of ["chef", "waiter", "", "guest"]) expect(fn(role), role).toBe(false);
    }
  });
});

describe("words", () => {
  it("the type words", () => {
    expect(countTypeWord("daily")).toBe("Giornaliero");
    expect(countTypeWord("monthly")).toBe("Mensile");
    expect(countTypeWord("daily", "en")).toBe("Daily");
  });

  it("the status badge: tone and word", () => {
    expect(countStatusView("open")).toEqual({ tone: "info", label: "In corso" });
    expect(countStatusView("closed")).toEqual({ tone: "neutral", label: "Chiuso" });
    expect(countStatusView("cancelled")).toEqual({ tone: "neutral", label: "Annullato" });
    expect(countStatusView("closed", "en").label).toBe("Closed");
  });

  it("a word for every action of the audit_event list and the five stock actions", () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        "invoice.approved",
        "invoice.rejected",
        "invoice.duplicate_cleared",
        "ingredient.allergens_confirmed",
        "ingredient.critical_changed",
        "recipe.deactivated",
        "recipe.reactivated",
        "tenant.settings_changed",
        "payable.status_changed",
        "payable.payment_reversed",
        "count_session.closed",
        "count_session.cancelled",
        "app_user.created",
        "app_user.updated",
        "app_user.deactivated",
        "app_user.reactivated",
        "app_user.pin_set",
        "device_enrolment.created",
        "venue_device.enrolled",
        "venue_device.revoked",
        "venue_device.unlocked",
        "waste",
        "consumption",
        "transfer",
        "count",
        "reversal",
        // M17
        "menu_item.created",
        "menu_item.updated",
        "dining_table.created",
        "dining_table.updated",
        "table_session.covers_changed",
        "sale_settings.changed",
      ]),
    );
    for (const action of AUDIT_ACTIONS) {
      for (const locale of ["it", "en"] as const) {
        const word = auditActionWord(action, locale);
        expect(word, `${action} ${locale}`).toMatch(/[A-Za-zÀ-ù]{3}/);
        expect(word).not.toContain("audit.action");
        // A known action never falls back to its code.
        expect(word, `${action} ${locale}`).not.toBe(action);
      }
    }
    expect(auditActionWord("waste")).toBe("Spreco");
    expect(auditActionWord("reversal")).toBe("Annullamento");
    expect(auditActionWord("count_session.closed")).toBe("Conteggio chiuso");
    expect(auditActionWord("ingredient.critical_changed")).toBe("Ingrediente critico");
    expect(auditActionWord("venue_device.revoked")).toBe("Dispositivo revocato");
    expect(auditActionWord("invoice.approved")).toBe("Fattura approvata");
  });

  it("an action this build does not know shows the code, never a missing key", () => {
    expect(auditActionWord("brand.new_action")).toBe("brand.new_action");
  });
});

describe("differenceText", () => {
  it("uses the real minus sign (U+2212) and a no-break space before the unit", () => {
    expect(differenceText(-0.5, "kg")).toBe("Differenza −0,5 kg");
    expect(differenceText(1.25, "l")).toBe("Differenza +1,25 l");
    expect(differenceText(-3, "pz")).toBe("Differenza −3 pz");
  });
  it("says there is no difference for zero", () => {
    expect(differenceText(0, "kg")).toBe("Nessuna differenza");
    expect(differenceText(0, "kg", "en")).toBe("No difference");
  });
  it("English", () => {
    expect(differenceText(-0.5, "kg", "en")).toBe("Difference −0.5 kg");
  });
});

describe("parseCountInput", () => {
  it("an empty field clears the line", () => {
    expect(parseCountInput("")).toEqual({ kind: "clear" });
    expect(parseCountInput("   ")).toEqual({ kind: "clear" });
  });
  it("reads a decimal with a comma or a dot, zero included", () => {
    expect(parseCountInput("4,5")).toEqual({ kind: "qty", value: 4.5 });
    expect(parseCountInput("4.5")).toEqual({ kind: "qty", value: 4.5 });
    expect(parseCountInput(" 7 ")).toEqual({ kind: "qty", value: 7 });
    expect(parseCountInput("0")).toEqual({ kind: "qty", value: 0 });
    expect(parseCountInput("0,0001")).toEqual({ kind: "qty", value: 0.0001 });
  });
  it.each(["-1", "+1", "1,23456", "abc", "1.234,5", "1,", ",5", "1e3", "100001", "1 2"])(
    "%s is invalid",
    (text) => {
      expect(parseCountInput(text)).toEqual({ kind: "invalid" });
    },
  );
  it("accepts the largest quantity", () => {
    expect(parseCountInput("100000")).toEqual({ kind: "qty", value: 100_000 });
  });
});

describe("formatCountEuro", () => {
  it("writes 1.234,50 € and uses the real minus sign for a loss", () => {
    expect(formatCountEuro(1234.5)).toBe("1.234,50\u00a0€");
    expect(formatCountEuro(-5)).toBe("\u22125,00\u00a0€");
    expect(formatCountEuro(-41.8)).toBe("\u221241,80\u00a0€");
  });
  it("zero has no sign", () => {
    expect(formatCountEuro(0)).toBe("0,00\u00a0€");
    expect(formatCountEuro(-0)).toBe("0,00\u00a0€");
  });
});
