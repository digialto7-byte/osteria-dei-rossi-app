import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runScriptLocal } from "./helpers/psql-script";
import { assertLocalDbUrl, LOCAL_DB_URL } from "./helpers/sql";
import { readStackEnv } from "./helpers/stack";

// scripts/reports/orphan-invoice-objects.sql (plan G6) against the local database. pgTAP cannot read a file, so the
// exact file contents are fed to psql here, inside one transaction that is always rolled back: the bucket's existing
// objects are removed (triggers off, as runSqlWithoutTriggers does) and the fake ones below are seeded, so the answer
// is exact whatever else the shared database holds. Fake data only. Skips on a developer machine without a stack
// (set STACK_DB_URL to a local database to run it); throws in CI when the stack settings are missing.
const URL_ = process.env.STACK_DB_URL ?? (readStackEnv() ? LOCAL_DB_URL : null);
// Before any SQL is sent: a non-local URL throws at import (and runScriptLocal checks again before every psql call).
if (URL_) assertLocalDbUrl(URL_);
const REPORT = readFileSync(
  new URL("../../scripts/reports/orphan-invoice-objects.sql", import.meta.url),
  "utf8",
);

const TENANT = "5a000000-0000-4000-8000-0000000000aa";
const ORPHAN_ID = "0badc0de-1111-4111-8111-000000000001";
const LINKED_ID = "11ced0c5-2222-4222-8222-000000000002";
const YOUNG_ID = "feedface-3333-4333-8333-000000000003";
const path = (id: string, ext = "pdf") => `${TENANT}/2026/${id}.${ext}`;
const OLD = "2026-10-01 10:00:00+00";

const CLEAN_ROOM = `set local session_replication_role = replica;
delete from storage.objects where bucket_id = 'invoices';`;
// The clean room runs with triggers off, so the tenant's organisation (SP2 S1, filled by a trigger otherwise) is written here.
const TENANT_ROW = `with o as (insert into platform.organisation (name, vat_number) values ('Osteria Fake', 'IT00000000000')
     on conflict (vat_number) do update set name = platform.organisation.name returning id)
   insert into public.tenant (id, name, vat_number, organisation_id) select '${TENANT}', 'Osteria Fake', 'IT00000000000', o.id from o;`;
const object = (id: string, size: number, createdAt: string, ext = "pdf") =>
  `insert into storage.objects (bucket_id, name, metadata, created_at)
   values ('invoices', '${path(id, ext)}', '{"size": ${size}, "mimetype": "application/pdf"}', ${createdAt});`;
const linkedInvoice = (id: string) =>
  `insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes)
   values ('${id}', '${TENANT}', '${path(id)}', 'application/pdf', 1000);`;

/** Runs the report on top of a seed, in a rolled-back transaction; returns the single result row by column. */
function report(seed: string): Record<string, string> {
  const rows = runScriptLocal(`begin;\n${CLEAN_ROOM}\n${seed}\n${REPORT}\nrollback;`, URL_!);
  expect(rows).toHaveLength(2); // header + exactly one row
  const [names, values] = rows as [string[], string[]];
  return Object.fromEntries(names.map((name, index) => [name, values[index]!]));
}

describe.skipIf(!URL_)("orphan invoice objects report (executes the real file)", () => {
  it("counts only the old orphan: bytes, oldest = newest, and the 8-character invoice-id prefix", () => {
    const row = report(
      [
        TENANT_ROW,
        object(ORPHAN_ID, 1234, `'${OLD}'`),
        object(LINKED_ID, 5000, `'${OLD}'`),
        linkedInvoice(LINKED_ID),
        object(YOUNG_ID, 777, "now() - interval '5 minutes'"),
      ].join("\n"),
    );
    expect(Object.keys(row)).toEqual([
      "orphan_count",
      "demo_cleanup_pending",
      "bucket_objects",
      "total_bytes",
      "oldest_created",
      "newest_created",
      "id_prefixes",
    ]);
    expect(row.orphan_count).toBe("1");
    expect(row.bucket_objects).toBe("2"); // the orphan and the linked one; the young one is inside the window
    expect(row.demo_cleanup_pending).toBe("0");
    expect(row.total_bytes).toBe("1234");
    expect(row.oldest_created).toBe(row.newest_created);
    expect(row.oldest_created).toMatch(/^2026-10-01 /);
    expect(row.id_prefixes).toBe("{0badc0de}");
    // Nothing identifying: no tenant id, no path, no full invoice id, no extension, no tenant name.
    const everything = Object.values(row).join("|");
    for (const secret of [TENANT, "2026/", ORPHAN_ID, ".pdf", "Osteria", ORPHAN_ID.slice(0, 9)]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("does not count a linked object, and treats the grace window as exclusive of young objects", () => {
    const row = report(
      [
        TENANT_ROW,
        object(LINKED_ID, 5000, `'${OLD}'`),
        linkedInvoice(LINKED_ID),
        object(YOUNG_ID, 777, "now() - interval '59 minutes'"),
      ].join("\n"),
    );
    expect(row.orphan_count).toBe("0");
  });

  it("counts an object just past the grace window", () => {
    const row = report(object(YOUNG_ID, 777, "now() - interval '61 minutes'"));
    expect(row.orphan_count).toBe("1");
    expect(row.id_prefixes).toBe("{feedface}");
  });

  it("sums several orphans, oldest first, and handles p7m and xml objects", () => {
    const row = report(
      [
        object(ORPHAN_ID, 100, `'${OLD}'`, "p7m"),
        object(YOUNG_ID, 23, "'2026-10-02 10:00:00+00'", "xml"),
      ].join("\n"),
    );
    expect(row.orphan_count).toBe("2");
    expect(row.total_bytes).toBe("123");
    expect(row.oldest_created).toMatch(/^2026-10-01 /);
    expect(row.newest_created).toMatch(/^2026-10-02 /);
    expect(row.id_prefixes).toBe("{0badc0de,feedface}");
  });

  it("ignores other buckets", () => {
    const row = report(
      `insert into storage.buckets (id, name) values ('other', 'other') on conflict do nothing;
       insert into storage.objects (bucket_id, name, metadata, created_at)
       values ('other', '${path(ORPHAN_ID)}', '{"size": 9}', '${OLD}');`,
    );
    expect(row.orphan_count).toBe("0");
  });

  it("counts an oddly named object but gives it no prefix (no part of an unknown name is shown)", () => {
    const row = report(
      `insert into storage.objects (bucket_id, name, metadata, created_at)
       values ('invoices', 'secret-supplier-name.pdf', '{"size": 10}', '${OLD}');`,
    );
    expect(row.orphan_count).toBe("1");
    expect(row.total_bytes).toBe("10");
    expect(row.id_prefixes).toBe("{}");
  });

  it("with no orphans still returns one row: count 0, 0 bytes, null dates, empty array", () => {
    const row = report("");
    expect(row).toEqual({
      orphan_count: "0",
      demo_cleanup_pending: "0",
      bucket_objects: "0",
      total_bytes: "0",
      oldest_created: "",
      newest_created: "",
      id_prefixes: "{}",
    });
  });

  const purgeLog = (cleaned: boolean) =>
    `insert into app.demo_purge_log (tenant_id, tenant_name, via, row_counts, file_paths, cleaned_at, auth_deleted, objects_deleted)
     values ('${TENANT}', 'Osteria Fake', 'script', '{}', ${cleaned ? "'{}'" : `array['${path(ORPHAN_ID)}']`},
             ${cleaned ? "now(), 0, 1" : "null, null, null"});`;

  it("excludes an object named in a pending demo purge log and counts it in demo_cleanup_pending", () => {
    const row = report(
      [object(ORPHAN_ID, 100, `'${OLD}'`), object(YOUNG_ID, 5, `'${OLD}'`), purgeLog(false)].join(
        "\n",
      ),
    );
    expect(row.orphan_count).toBe("1");
    expect(row.demo_cleanup_pending).toBe("1");
    expect(row.bucket_objects).toBe("2");
    expect(row.total_bytes).toBe("5");
    expect(row.id_prefixes).toBe("{feedface}");
  });

  it("counts that object as an orphan again once its purge log row is cleaned", () => {
    const row = report([object(ORPHAN_ID, 100, `'${OLD}'`), purgeLog(true)].join("\n"));
    expect(row.orphan_count).toBe("1");
    expect(row.demo_cleanup_pending).toBe("0");
    expect(row.id_prefixes).toBe("{0badc0de}");
  });

  it("caps id_prefixes at the 50 oldest, oldest first, while orphan_count is the full count", () => {
    const row = report(
      `insert into storage.objects (bucket_id, name, metadata, created_at)
       select 'invoices', '${TENANT}/2026/' || lpad(to_hex(n), 8, '0') || '-0000-4000-8000-000000000000.pdf',
              '{"size": 1}', timestamptz '2026-01-01 00:00:00+00' + n * interval '1 minute'
       from generate_series(1, 60) n;`,
    );
    expect(row.orphan_count).toBe("60");
    expect(row.total_bytes).toBe("60");
    const prefixes = row.id_prefixes!.slice(1, -1).split(",");
    expect(prefixes).toHaveLength(50);
    expect(prefixes[0]).toBe("00000001");
    expect(prefixes[49]).toBe("00000032");
  });

  it("runs inside a read-only transaction", () => {
    // The seed needs writes, so this runs the report alone on top of whatever the database holds.
    const rows = runScriptLocal(`begin transaction read only;\n${REPORT}\ncommit;`, URL_!);
    expect(rows[0]).toContain("orphan_count");
  });
});
