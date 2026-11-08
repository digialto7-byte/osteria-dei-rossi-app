// The manifest of a backup (M25 step 10): which migrations the database had and how many rows each table held. Names and
// integers only, so it can be logged and compared after a restore.

export type Manifest = {
  version: 1;
  createdAt: string;
  migrations: string[];
  tables: Record<string, number>;
};

const MIGRATION = /^\d{14}$/;
const TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/**
 * Read-only query, one JSON row `{migrations, tables}`: the applied migration versions and the exact row count of every
 * ordinary table in `public` and `auth`. Counts come from query_to_xml so one statement covers every table.
 */
export const MANIFEST_SQL = `select json_build_object(
  'migrations', (select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations),
  'tables', (select coalesce(json_object_agg(s || '.' || t, c), '{}'::json)
               from (select n.nspname as s, r.relname as t,
                            (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, r.relname), false, true, '')))[1]::text::bigint as c
                       from pg_class r join pg_namespace n on n.oid = r.relnamespace
                      where r.relkind = 'r' and n.nspname in ('public', 'auth')) x)
)`;

function fail(): never {
  throw new Error("manifest_invalid");
}

/** Validates the raw `{migrations, tables}` and stamps it. Anything that is not a name or an integer is refused. */
export function buildManifest(raw: unknown, createdAt: string): Manifest {
  if (typeof raw !== "object" || raw === null) return fail();
  const { migrations, tables } = raw as { migrations?: unknown; tables?: unknown };
  if (Number.isNaN(Date.parse(createdAt)) || !/^\d{4}-\d\d-\d\dT/.test(createdAt)) return fail();
  if (
    !Array.isArray(migrations) ||
    !migrations.every((m) => typeof m === "string" && MIGRATION.test(m))
  ) {
    return fail();
  }
  if (typeof tables !== "object" || tables === null || Array.isArray(tables)) return fail();
  const counts: Record<string, number> = {};
  for (const [name, count] of Object.entries(tables)) {
    if (!TABLE.test(name) || typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      return fail();
    }
    counts[name] = count;
  }
  return { version: 1, createdAt, migrations: [...(migrations as string[])], tables: counts };
}

export function parseManifest(text: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail();
  }
  if (typeof parsed !== "object" || parsed === null) return fail();
  const { version, createdAt, ...rest } = parsed as { version?: unknown; createdAt?: unknown };
  if (version !== 1 || typeof createdAt !== "string") return fail();
  return buildManifest(rest, createdAt);
}

/** What differs between the dump's manifest and the restored database's, as sentences with names and numbers only. */
export function compareManifests(expected: Manifest, actual: Manifest): string[] {
  const out: string[] = [];
  const names = [
    ...new Set([...Object.keys(expected.tables), ...Object.keys(actual.tables)]),
  ].sort();
  for (const name of names) {
    const want = expected.tables[name];
    const got = actual.tables[name];
    if (want !== got) {
      out.push(`table ${name}: expected ${want ?? "nothing"}, found ${got ?? "nothing"}`);
    }
  }
  const dump = new Set(expected.migrations);
  const restored = new Set(actual.migrations);
  for (const m of [...new Set([...dump, ...restored])].sort()) {
    if (dump.has(m) && !restored.has(m))
      out.push(`migration ${m}: in the dump, not in the restore`);
    if (!dump.has(m) && restored.has(m))
      out.push(`migration ${m}: in the restore, not in the dump`);
  }
  return out;
}
