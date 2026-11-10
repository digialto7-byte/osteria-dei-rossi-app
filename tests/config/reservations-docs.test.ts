import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reservations plan §5 B13: the documents of the public booking page. The client facts are placeholders until the founder approves them (nothing is invented), the Vault guide
// lists the three new secrets, and the runbook covers switching on, rotating the keys and erasing a customer's data.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("docs/client-facts.md", () => {
  const text = read("docs/client-facts.md");

  it("has the four placeholders, each exactly `[PENDING founder]`, and no value", () => {
    for (const label of [
      "Legal name",
      "VAT number",
      "Privacy contact e-mail",
      "Booking hours per service",
    ]) {
      expect(text, label).toContain(`\n- ${label}: [PENDING founder]\n`);
    }
  });

  it("does not turn them into facts: no VAT-looking number, no e-mail address", () => {
    expect(text).not.toMatch(/\bIT\d{11}\b(?!`)/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it("says why they are pending and where the real values go", () => {
    expect(text).toMatch(/reservations/i);
    expect(text).toMatch(/owner enters|tenant settings/i);
  });
});

describe("docs/guides/cron-vault-secrets.md", () => {
  const text = read("docs/guides/cron-vault-secrets.md");

  it("lists the three reservation secrets with where each value comes from", () => {
    for (const name of [
      "reservation_gate_key",
      "reservation_gate_key_next",
      "reservation_hash_salt",
    ]) {
      expect(text, name).toContain(`\`${name}\``);
    }
    expect(text).toContain("RESERVATION_GATE_KEY");
  });

  it("says the salt is Vault only and the next key exists only while rotating", () => {
    expect(text).toMatch(/reservation_hash_salt[^\n]*Vault only|never in the environment/i);
    expect(text).toMatch(/reservation_gate_key_next[^\n]*(rotat|only while)/i);
  });

  it("keeps placeholders only: no value that looks like a key", () => {
    expect(text).not.toMatch(/[A-Za-z0-9+]{32,}/);
  });
});

describe("docs/guides/prenotazioni.md", () => {
  const text = read("docs/guides/prenotazioni.md");

  it("has the three procedures and the founder steps", () => {
    for (const heading of [
      "## Switch the page on",
      "## Rotate the keys",
      "## Erase a customer's data on request",
      "## Before real customers",
    ]) {
      expect(text, heading).toContain(heading);
    }
  });

  it("names the screens, the settings and the variables it uses", () => {
    for (const term of [
      "Prenotazioni online",
      "Indirizzo della pagina",
      "Cancella dati cliente",
      "RESERVATION_GATE_KEY",
      "RESERVATION_LINK_KEY_PREVIOUS",
      "reservation_gate_key_next",
      "reservation_hash_salt",
      "MAIL_TRANSPORT",
      "RESEND_API_KEY",
      "/prenota/",
    ]) {
      expect(text, term).toContain(term);
    }
  });

  it("states the open items as the founder's, and does not invent facts", () => {
    expect(text).toMatch(/Q-R12/);
    expect(text).toMatch(/Q-R14/);
    expect(text).toContain("[PENDING founder]");
    expect(text).not.toMatch(/€|\bIT\d{11}\b/);
  });

  it("holds no secret-looking value", () => {
    expect(text).not.toMatch(/[A-Za-z0-9+]{32,}/);
  });
});
