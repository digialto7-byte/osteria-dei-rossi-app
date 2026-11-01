import type { ExportRole, ExportTable } from "./types";
import { renderCsv } from "./render";

/** Only ASCII letters, digits, "_" and "-" may reach the file name: it is built from a registry slug and ISO dates (plan §6, file-name injection). */
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

export function csvFileName(slug: string, range: string): string {
  if (!SAFE_NAME.test(slug) || !SAFE_NAME.test(range)) {
    throw new Error("export file name has an unexpected character");
  }
  return `report-${slug}-${range}.csv`;
}

/** The CSV reply: UTF-8 attachment, `Server-Timing` from the route; `Cache-Control: no-store` is added by withApi. */
export function csvResponse<Q, O, R>(
  table: ExportTable<Q, O, R>,
  output: O,
  role: ExportRole,
  timingHeader: string,
): Response {
  return new Response(renderCsv(table, output, role), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFileName(table.slug, table.range(output))}"`,
      "server-timing": timingHeader,
    },
  });
}
