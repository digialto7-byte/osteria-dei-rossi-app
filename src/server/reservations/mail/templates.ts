import type { Locale } from "@/lib/i18n/locale";

/** What an e-mail says, before it is written as text or HTML. */
export interface MailParts {
  lead: string;
  status: string;
  /** Label and value pairs: when, people, service. */
  details: [label: string, value: string][];
  cancel: { lead: string; label: string; url: string } | null;
  footer: string;
}

/** Escapes text for HTML, attribute values included. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textMail(parts: MailParts): string {
  const lines = [parts.lead, "", parts.status, ""];
  for (const [label, value] of parts.details) lines.push(`${label}: ${value}`);
  if (parts.cancel) lines.push("", parts.cancel.lead, parts.cancel.url);
  lines.push("", "--", parts.footer, "");
  return lines.join("\n");
}

// Mail clients ignore style sheets, so the few styles are inline: this is an e-mail, not a page of the app.
export function htmlMail(parts: MailParts, locale: Locale): string {
  const rows = parts.details
    .map(
      ([label, value]) =>
        `<p style="margin:0 0 4px"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`,
    )
    .join("");
  const cancel = parts.cancel
    ? `<p style="margin:24px 0 8px">${escapeHtml(parts.cancel.lead)}</p>` +
      `<p style="margin:0 0 24px"><a href="${escapeHtml(parts.cancel.url)}" style="color:#7a1f1f">${escapeHtml(parts.cancel.label)}</a></p>`
    : "";
  return (
    `<!doctype html><html lang="${locale}"><body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.5">` +
    `<div style="max-width:480px;margin:0 auto;padding:16px">` +
    `<p>${escapeHtml(parts.lead)}</p><p>${escapeHtml(parts.status)}</p>${rows}${cancel}` +
    `<p style="margin-top:24px;font-size:12px;color:#666">${escapeHtml(parts.footer)}</p>` +
    `</div></body></html>`
  );
}
