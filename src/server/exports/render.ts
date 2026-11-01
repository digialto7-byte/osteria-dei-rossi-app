import { toCsv } from "@/lib/csv/write";
import type { ExportRole, ExportTable } from "./types";

/** The whole CSV of a table's output for a role: the header from its columns, one row per `rows(output)` entry. */
export function renderCsv<Q, O, R>(
  table: ExportTable<Q, O, R>,
  output: O,
  role: ExportRole,
): string {
  const columns = table.columns(role);
  return toCsv(
    columns.map((c) => c.header),
    table.rows(output).map((row) => columns.map((c) => c.cell(row))),
  );
}
