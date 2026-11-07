// AT3 (M25 step 5): the dependency audit gate. Pure logic; scripts/audit-check.ts runs npm and prints.
// A high or critical advisory fails unless docs/go-live/audit-exceptions.json excepts it with a reason and a review date.
import { z } from "zod";

const GATED = new Set(["high", "critical"]);

type Advisory = { name: string; severity: string; url?: string; source?: number | string };
type Vulnerability = { name: string; severity: string; via: Array<string | Advisory> };
export type AuditReport = {
  auditReportVersion?: number;
  vulnerabilities: Record<string, Vulnerability>;
};

const exceptionSchema = z.object({
  package: z.string().min(1),
  advisory: z.string().min(1),
  reason: z.string(),
  reviewBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  devOnly: z.boolean(),
});
const exceptionsSchema = z.object({ exceptions: z.array(exceptionSchema) });
export type AuditExceptions = z.infer<typeof exceptionsSchema>;

export function parseExceptions(raw: unknown): AuditExceptions {
  return exceptionsSchema.parse(raw);
}

type Found = { package: string; advisory: string; severity: string };

// Every high or critical advisory in a report, once per package and advisory id (the GHSA id, else npm's source number).
function gatedAdvisories(report: AuditReport): Found[] {
  const found = new Map<string, Found>();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via) {
      if (typeof via === "string" || !GATED.has(via.severity)) continue;
      const advisory = via.url?.split("/").pop() || String(via.source);
      found.set(`${via.name}\u0000${advisory}`, {
        package: via.name,
        advisory,
        severity: via.severity,
      });
    }
  }
  return [...found.values()];
}

/** Failure messages, empty when the gate passes. `prod` is the report for `--omit=dev` (the runtime tree). */
export function evaluateAudit(
  all: AuditReport,
  prod: AuditReport,
  exceptions: AuditExceptions,
  today: string,
): string[] {
  const runtime = new Set(gatedAdvisories(prod).map((a) => `${a.package}\u0000${a.advisory}`));
  const failures: string[] = [];
  const used = new Set<number>();

  for (const found of gatedAdvisories(all)) {
    const label = `${found.severity} advisory ${found.advisory} in ${found.package}`;
    const index = exceptions.exceptions.findIndex(
      (e) => e.package === found.package && e.advisory === found.advisory,
    );
    if (index < 0) {
      failures.push(`${label}: not excepted`);
      continue;
    }
    used.add(index);
    const e = exceptions.exceptions[index]!;
    if (e.reason.trim() === "") {
      failures.push(`${label}: its exception has no reason`);
    } else if (e.reviewBy < today) {
      failures.push(`${label}: exception expired on ${e.reviewBy}`);
    } else if (e.devOnly && runtime.has(`${found.package}\u0000${found.advisory}`)) {
      failures.push(`${label}: it is in the runtime tree but its exception says devOnly`);
    }
  }

  exceptions.exceptions.forEach((e, index) => {
    if (!used.has(index)) {
      failures.push(
        `stale exception for ${e.package} ${e.advisory}: it matches no current advisory`,
      );
    }
  });
  return failures;
}
