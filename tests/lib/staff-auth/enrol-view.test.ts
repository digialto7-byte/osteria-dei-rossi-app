import { describe, expect, it } from "vitest";
import { enrolFeedback, enrolSuccessText } from "@/lib/staff-auth/enrol-view";

const error = (code: string) => ({ code, message: "server text" });

describe("enrolFeedback", () => {
  it.each(["enrolment_code_invalid", "enrolment_code_used", "enrolment_code_expired"])(
    "%s shows the same 'Codice non valido o scaduto' text",
    (code) => {
      expect(enrolFeedback(error(code))).toBe(
        "Codice non valido o scaduto. Chiedi un nuovo codice al titolare.",
      );
    },
  );
  it("429 shows its own text", () => {
    expect(enrolFeedback(error("enrol_rate_limited"))).toBe(
      "Troppi tentativi. Riprova tra 15 minuti.",
    );
  });
  it.each(["network", "internal", "bad_response", "x"])("%s -> service unavailable", (code) => {
    expect(enrolFeedback(error(code))).toBe("Servizio non disponibile, riprova tra poco.");
  });
  it("english second, and never the server's text", () => {
    expect(enrolFeedback(error("enrolment_code_used"), "en")).toBe(
      "Invalid or expired code. Ask the owner for a new one.",
    );
    expect(enrolFeedback(error("internal"))).not.toContain("server text");
  });
});

describe("enrolSuccessText", () => {
  it("names the device", () => {
    expect(enrolSuccessText("Telefono sala (demo)")).toBe(
      "Dispositivo abilitato: Telefono sala (demo).",
    );
    expect(enrolSuccessText("Tablet", "en")).toBe("Device enabled: Tablet.");
  });
});
