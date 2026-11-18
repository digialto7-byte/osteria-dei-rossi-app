import { describe, expect, it } from "vitest";
import { htmlMail, type MailParts } from "@/server/reservations/mail/templates";

// The guest e-mails wear the Costì values (designer ruling, 2026-11-18): the system font stack, ink #1F2933 at line-height 1.5, links
// #0E4D3A underlined, a 12px #555D64 footer, no background (white), no web fonts, and no Costì name, logo or venue accent: the mail is
// the venue's, not Costì's. Exact strings, so a drifted value fails.
// The designer's stack names "Segoe UI" in double quotes. Inside a double-quoted HTML style attribute it is written with single quotes, the
// same CSS value, because some mail clients mishandle &quot; inside inline styles.
const BODY_STYLE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1F2933;line-height:1.5";
const LINK_STYLE = "color:#0E4D3A;text-decoration:underline";
const FOOTER_STYLE = "margin-top:24px;font-size:12px;color:#555D64";

const parts: MailParts = {
  lead: "Ciao <b>Mario</b> (demo),",
  status: "La tua prenotazione è confermata.",
  details: [["Quando", "sab 12 dic 1998, 20:00"]],
  cancel: { lead: "Non puoi venire?", label: "Annulla", url: 'https://example.test/p/x?t=a&b="c"' },
  footer: "Osteria Demo (demo)",
};

describe("htmlMail, the Costì values", () => {
  const html = htmlMail(parts, "it");

  it("sets the body to the system stack, ink #1F2933 and line-height 1.5", () => {
    expect(html).toContain(`<body style="${BODY_STYLE}">`);
  });

  it("underlines links in #0E4D3A", () => {
    expect(html).toContain(`style="${LINK_STYLE}"`);
  });

  it("writes the footer at 12px in #555D64", () => {
    expect(html).toContain(`<p style="${FOOTER_STYLE}">Osteria Demo (demo)</p>`);
  });

  it("sets no background, loads no web font and carries no old colour", () => {
    expect(html).not.toMatch(/background/i);
    expect(html).not.toMatch(/@import|@font-face|<link|fonts\.googleapis/i);
    for (const old of ["#7a1f1f", "#222", "#666", "#f6f1e8", "#F7F7F5", "cream", "Off-white"]) {
      expect(html, old).not.toContain(old);
    }
  });

  it("names neither Costì nor shows a logo", () => {
    expect(html).not.toMatch(/cost[iì]/i);
    expect(html).not.toMatch(/<img|<svg/i);
  });

  it("still escapes every value, the link included", () => {
    expect(html).toContain("Ciao &lt;b&gt;Mario&lt;/b&gt; (demo),");
    expect(html).toContain('href="https://example.test/p/x?t=a&amp;b=&quot;c&quot;"');
  });
});
