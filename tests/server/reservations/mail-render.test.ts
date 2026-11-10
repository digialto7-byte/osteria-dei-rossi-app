import { describe, expect, it } from "vitest";
import { signCancelToken, verifyCancelToken } from "@/server/reservations/public/tokens";
import {
  claimedMail,
  renderReservationMail,
  type ClaimedMail,
} from "@/server/reservations/mail/render";
import { messages } from "@/lib/i18n";

// Reservations plan §5 B9: the e-mail texts. Fake data only. A claimed row's date and time are already the venue's local wall time.
const LINK_KEY = "test-link-key-0123456789-abcdefghij";
const keys = { current: LINK_KEY };
const ORIGIN = "https://app.example.com";
const ID = "23000000-0000-4000-8000-000000000001";
const EXP = 1_794_132_000;

const row = (overrides: Partial<ClaimedMail> = {}): ClaimedMail => ({
  id: "24000000-0000-4000-8000-0000000000aa",
  kind: "received",
  to: "cliente.demo@example.com",
  locale: "it",
  name: "Cliente Demo",
  venueName: "Osteria Demo A",
  slug: "osteria-demo-a",
  reservationId: ID,
  date: "2026-11-20",
  time: "20:00",
  party: 4,
  serviceName: "Cena",
  cancelExp: EXP,
  ...overrides,
});
const render = (overrides: Partial<ClaimedMail> = {}) =>
  renderReservationMail(row(overrides), { origin: ORIGIN, keys });

describe("renderReservationMail", () => {
  it.each(["received", "accepted", "declined"] as const)(
    "%s in Italian and English (snapshot)",
    (kind) => {
      const it = render({ kind, cancelExp: kind === "declined" ? null : EXP });
      const en = render({ kind, locale: "en", cancelExp: kind === "declined" ? null : EXP });
      expect({ it, en }).toMatchSnapshot();
    },
  );

  it.each(["received", "accepted"] as const)(
    "%s carries the cancel URL with a token that verifies",
    (kind) => {
      for (const locale of ["it", "en"] as const) {
        const mail = render({ kind, locale });
        const url = /https:\/\/app\.example\.com\/prenota\/osteria-demo-a\/annulla\?t=(\S+)/.exec(
          mail.text,
        );
        expect(url, `${kind} ${locale}`).not.toBeNull();
        const token = decodeURIComponent(url![1]!);
        expect(token).toBe(signCancelToken(keys, ID, EXP));
        expect(verifyCancelToken(keys, token, EXP - 1)).toEqual({ reservationId: ID, exp: EXP });
        expect(mail.html).toContain(`/prenota/osteria-demo-a/annulla?t=${token}`);
      }
    },
  );

  it("gives declined no cancel link, even when a slug and an expiry are present", () => {
    const mail = render({ kind: "declined", cancelExp: EXP });
    expect(mail.text).not.toContain("/annulla");
    expect(mail.html).not.toContain("/annulla");
    expect(mail.html).not.toContain("<a ");
  });

  it("sends no cancel link when the page has no slug or there is no expiry", () => {
    for (const mail of [render({ slug: null }), render({ cancelExp: null })]) {
      expect(mail.text).not.toContain("/annulla");
      expect(mail.html).not.toContain("/annulla");
    }
  });

  it("escapes a name, venue and service with markup in the HTML, and keeps the text raw", () => {
    const mail = render({
      name: "<b>Demo</b>",
      venueName: 'Osteria "Demo" & <i>Figli</i>',
      serviceName: "<script>alert(1)</script>",
    });
    expect(mail.html).not.toContain("<b>Demo</b>");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<i>Figli</i>");
    expect(mail.html).toContain("&lt;b&gt;Demo&lt;/b&gt;");
    expect(mail.html).toContain("&quot;Demo&quot; &amp; &lt;i&gt;Figli&lt;/i&gt;");
    expect(mail.text).toContain("<b>Demo</b>");
  });

  it("keeps a line break out of the subject (no header injection)", () => {
    const mail = render({ venueName: "Osteria\r\nBcc: spy@example.com" });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it("writes the date in Europe/Rome, in Italian and English", () => {
    expect(render().text).toContain("ven 20 novembre 2026, 20:00");
    expect(render({ locale: "en" }).text).toMatch(/Fri,? 20 November 2026,? 20:00/);
    // Summer time is the same wall time: the row is already local.
    expect(render({ date: "2027-07-02", time: "21:30" }).text).toContain(
      "ven 2 luglio 2027, 21:30",
    );
  });

  it("shows the party and the service, with a singular", () => {
    expect(render().text).toContain("4 persone");
    expect(render({ party: 1 }).text).toContain("1 persona");
    expect(render({ locale: "en", party: 1 }).text).toContain("1 person");
    expect(render().text).toContain("Cena");
  });

  it("never shows a euro sign, a price or a table name, in any template or language", () => {
    for (const kind of ["received", "accepted", "declined"] as const) {
      for (const locale of ["it", "en"] as const) {
        const mail = render({ kind, locale });
        const all = `${mail.subject}\n${mail.text}\n${mail.html}`;
        expect(all, `${kind} ${locale}`).not.toMatch(/€|EUR|\bprezzo\b|\bprice\b/i);
        expect(all, `${kind} ${locale}`).not.toMatch(/tavol|\btable\b/i);
      }
    }
  });

  it("has an it and en text for every key it uses", () => {
    const keys = Object.keys(messages.it).filter((k) => k.startsWith("reservationMail."));
    expect(keys.length).toBeGreaterThan(8);
    for (const key of keys) expect(key in messages.en, key).toBe(true);
  });

  it("includes the greeting with the name and a sensible subject per kind", () => {
    expect(render({ kind: "received" }).subject).toContain("Osteria Demo A");
    expect(render({ kind: "accepted" }).subject).toMatch(/confermata/i);
    expect(render({ kind: "declined" }).subject).toMatch(/non/i);
    expect(render({ kind: "accepted", locale: "en" }).subject).toMatch(/confirmed/i);
    expect(render().text).toContain("Cliente Demo");
  });
});

describe("claimedMail", () => {
  it("parses a claimed row strictly", () => {
    expect(claimedMail.safeParse(row()).success).toBe(true);
    expect(claimedMail.safeParse(row({ slug: null, cancelExp: null })).success).toBe(true);
    expect(claimedMail.safeParse({ ...row(), extra: 1 }).success).toBe(false);
    expect(claimedMail.safeParse({ ...row(), kind: "sms" }).success).toBe(false);
    expect(claimedMail.safeParse({ ...row(), locale: "fr" }).success).toBe(false);
  });
});
