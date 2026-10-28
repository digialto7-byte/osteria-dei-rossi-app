// Demo data (docs/plans/2026-10-24-demo-data.md §3.1.4): the fake invoice file. A valid one-page PDF built by hand (no library),
// with one line of text that says it has no fiscal value. Every demo invoice uploads these same bytes under its own path.
import { PDF_TEXT } from "./fixture";

/** A one-page A4 PDF, a few hundred bytes. The text is plain ASCII, so the byte offsets are exact. */
export function demoInvoicePdf(): Uint8Array {
  const text = PDF_TEXT.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 14 Tf 56 780 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
