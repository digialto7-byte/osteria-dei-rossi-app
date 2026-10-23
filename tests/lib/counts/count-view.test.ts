import { describe, expect, it } from "vitest";
import {
  auditActionWord,
  canCount,
  canReadAudit,
  canReadCountCosts,
  countStatusView,
  countTypeWord,
  differenceText,
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
        "waste",
        "consumption",
        "transfer",
        "count",
        "reversal",
      ]),
    );
    for (const action of AUDIT_ACTIONS) {
      for (const locale of ["it", "en"] as const) {
        const word = auditActionWord(action, locale);
        expect(word, `${action} ${locale}`).toMatch(/[A-Za-zÀ-ù]{3}/);
        expect(word).not.toContain("audit.action");
      }
    }
    expect(auditActionWord("waste")).toBe("Spreco");
    expect(auditActionWord("reversal")).toBe("Annullamento");
    expect(auditActionWord("count_session.closed")).toBe("Conteggio chiuso");
    expect(auditActionWord("ingredient.critical_changed")).toBe("Ingrediente critico");
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
