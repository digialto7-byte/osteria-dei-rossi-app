import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Comanda per uscita, step 8 (docs/plans/2026-11-18-comanda-uscite.md section 3.8; lead ruling M5, 2026-11-18). order_line.uscita has
// default 1: the one sanctioned Rule B exception for that column. No API role may INSERT into order_line (pgTAP 423), but service_role keeps
// Supabase's table grant, so this guard proves that no code in src/ or scripts/ writes order_line through the client (a direct insert or
// upsert would silently take the default). Every line is written by the procedures, which name uscita (pgTAP 423 scans them).
/** A client write on order_line: `.from("order_line")` followed, in the same chain, by `.insert(` or `.upsert(`. */
const CLIENT_WRITE = /\.from\(\s*["'`]order_line["'`]\s*\)[\s\S]{0,200}?\.(insert|upsert)\s*\(/g;

function findOrderLineWrites(source: string): string[] {
  return [...source.matchAll(CLIENT_WRITE)].map((m) => m[0].replace(/\s+/g, " "));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

describe("no client write to order_line", () => {
  it("self-test: the scanner finds an insert and an upsert, and lets reads and other tables through", () => {
    expect(findOrderLineWrites('supabase.from("order_line").insert({ id })')).toHaveLength(1);
    expect(
      findOrderLineWrites("db\n  .from('order_line')\n  .upsert(rows, { onConflict: 'id' })"),
    ).toHaveLength(1);
    expect(findOrderLineWrites('supabase.from("order_line").select("id").eq("id", x)')).toEqual([]);
    expect(findOrderLineWrites('supabase.from("order_line_cost").insert({ id })')).toEqual([]);
    expect(findOrderLineWrites('supabase.rpc("add_order_line", { p_session })')).toEqual([]);
  });

  it("finds none in src/ and scripts/", () => {
    const offences = ["src", "scripts"].flatMap((dir) =>
      sourceFiles(join(process.cwd(), dir)).flatMap((file) =>
        findOrderLineWrites(readFileSync(file, "utf8")).map(
          (hit) => `${relative(process.cwd(), file)}: ${hit}`,
        ),
      ),
    );
    expect(offences).toEqual([]);
  });
});
