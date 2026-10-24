// Demo data (docs/plans/2026-10-24-demo-data.md §3.4, §3.1.3): the one JSON line the script prints. It is built from an
// allow-list of fields, so a password, a PIN, a token or a key that ends up on an input object can never reach the output.
// Counts, ids, role labels and masked identities only.
import type { DemoMode, DemoTarget } from "./target";

export interface LoginInput {
  role: string;
  name: string;
  /** The full address; masked by buildReport. Only accounts that sign in with an e-mail have one. */
  email?: string;
}
export interface Login {
  role: string;
  name: string;
  email?: string;
}

export interface ReportInput {
  target: DemoTarget;
  mode: DemoMode;
  ok: boolean;
  tenantId: string | null;
  counts: Record<string, number>;
  logins: LoginInput[];
  alerts: string[];
  /** A short machine code such as `demo_tenant_exists`; anything else becomes `failed`. */
  error?: string;
}
export interface DemoReport {
  target: DemoTarget;
  mode: DemoMode;
  ok: boolean;
  tenantId: string | null;
  counts: Record<string, number>;
  logins: Login[];
  alerts: string[];
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z0-9_]{1,60}$/;
const LABEL = /^[A-Za-z0-9_.:-]{1,60}$/;

/** `titolare.demo@example.test` becomes `t***@e***.test`. Anything that is not a plain address becomes `***`. */
export function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return "***";
  const [local, domain] = [parts[0]!, parts[1]!];
  const labels = domain.split(".");
  if (local === "" || labels.length < 2 || labels.some((label) => label === "")) return "***";
  const tld = labels[labels.length - 1]!;
  return `${local[0]}***@${domain[0]}***.${tld}`;
}

export function buildReport(input: ReportInput): DemoReport {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.counts)) {
    if (CODE.test(key) && typeof value === "number" && Number.isInteger(value) && value >= 0) {
      counts[key] = value;
    }
  }
  const report: DemoReport = {
    target: input.target,
    mode: input.mode,
    ok: input.ok,
    tenantId: input.tenantId !== null && UUID.test(input.tenantId) ? input.tenantId : null,
    counts,
    logins: input.logins.map((login) => ({
      role: login.role,
      name: login.name,
      ...(login.email !== undefined ? { email: maskEmail(login.email) } : {}),
    })),
    alerts: input.alerts.filter((kind) => LABEL.test(kind)),
  };
  if (input.error !== undefined) report.error = CODE.test(input.error) ? input.error : "failed";
  return report;
}

export function formatReport(report: DemoReport): string {
  return JSON.stringify(report);
}
