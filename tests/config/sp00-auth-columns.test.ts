import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// On hosted Supabase auth.users belongs to supabase_auth_admin: information_schema.columns lists only the columns the current role holds a
// privilege on, so it can come back empty and leave the clones' GoTrue text columns NULL while self-check D2c checks nothing. The fill and D2c
// read the catalogue (pg_attribute) instead, which lists every column whatever the privileges.
const SQL = join(process.cwd(), "scripts/spike/sp00/sql");

describe("SP0 reads auth.users columns from the catalogue", () => {
  for (const file of ["04_t4.sql", "90_selfcheck_d.sql"]) {
    it(`${file} finds GoTrue's text columns through pg_attribute, not information_schema`, () => {
      const sql = readFileSync(join(SQL, file), "utf8");
      expect(sql).toMatch(/from pg_attribute a\s+where a\.attrelid = 'auth\.users'::regclass/);
      expect(sql).not.toMatch(/information_schema\.columns/);
    });
  }
});
