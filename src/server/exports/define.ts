import type { ExportTable } from "./types";

/** Keeps the concrete query, output and row types of a table while it is written; the registry stores it as it is. */
export function defineExport<Q, O, R>(table: ExportTable<Q, O, R>): ExportTable<Q, O, R> {
  return table;
}
