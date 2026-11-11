import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reservations plan §5 B13: the documents of the public booking page. The client facts are placeholders until the founder approves them (nothing is invented), the Vault guide
// lists the three new secrets, and the runbook covers switching on, rotating the keys and erasing a customer's data.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("docs/client-facts.md", () => {
  const text = read("docs/client-facts.md");

  it("keeps the two still-pending facts as exactly `[PENDING founder]`", () => {
    for (const label of ["Privacy contact e-mail", "Booking hours per service"]) {
      expect(text, label).toContain(`\n- ${label}: [PENDING founder]\n`);
    }
  });

  it("carries the approved legal facts exactly, each with its source (DigiAlto-Ops profile, founder 2026-11-11)", () => {
    const source = "(DigiAlto-Ops profile, founder 2026-11-11";
    expect(text).toContain(`\n- Legal name: ML SNC DI LANARO E FRESI ${source})\n`);
    expect(text).toContain(`\n- VAT number: IT00354250524 ${source})\n`);
    expect(text).toContain(
      `\n- Registered address: Via dei Rossi 79/81, 53100 Siena (SI), Italy ${source};`,
    );
  });

  it("invents nothing else: the approved VAT number is the only one, and there is no e-mail address", () => {
    const vat = [...text.matchAll(/\bIT\d{11}\b(?!`)/g)].map((m) => m[0]);
    expect(vat).toEqual(["IT00354250524"]);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it("does not use the unconfirmed number given with the legal name as a fact", () => {
    expect(text).toMatch(/01358391[^\n]*(no confirmed meaning|must not be used)/);
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

  it("explains where the per-IP limit gets the address, and what to change behind a CDN or proxy", () => {
    const section = /## The client address[\s\S]*?(?=\n## |$)/.exec(text)?.[0] ?? "";
    expect(section, "a section on the client address").not.toBe("");
    expect(section).toContain("first `x-forwarded-for` entry");
    expect(section).toMatch(/Vercel sets and overwrites/);
    expect(section).toMatch(/cannot be spoofed on Vercel/);
    expect(section).toMatch(/CDN or proxy/);
    expect(section).toMatch(/one IP/);
    expect(section).toMatch(/5 .*per day/);
    expect(section).toContain("`x-vercel-forwarded-for`");
  });

  it("holds no secret-looking value", () => {
    expect(text).not.toMatch(/[A-Za-z0-9+]{32,}/);
  });
});
