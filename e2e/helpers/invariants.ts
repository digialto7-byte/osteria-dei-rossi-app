import { quoteUuid, runSql } from "../../tests/integration/helpers/sql";

// The last check of the service simulation (M25 step 16, plan A2): "the invariants are clean" means `app.ledger_checks_body` returns no row for the
// tenant. That function is the checks only, read-only; the nightly runner also judges job health (which depends on the environment), writes a
// `job_run` and may raise an alert, so it is not used here. The function is closed to every API role, so it runs through `psql` as the database
// owner, on the local stack only (`runSql` refuses any other host). Test code only.

/** The statement for one tenant, one line per failing check. The tenant id must be a uuid: it is the only value that goes into SQL. */
export function ledgerFindingsSql(tenantId: string): string {
  return `select check_key || ' (' || rows_count || ')' from app.ledger_checks_body(${quoteUuid(tenantId)}, now()) order by check_key`;
}

/** The failing checks of a tenant, as "check_key (rows)"; `[]` when the ledgers are clean. */
export function ledgerFindings(
  tenantId: string,
  run: (statement: string) => string = (statement) => runSql(statement),
): string[] {
  const statement = ledgerFindingsSql(tenantId);
  return run(statement)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
