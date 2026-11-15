import { describe, expect, it } from "vitest";
import {
  auditQuerySchema,
  auditResponseSchema,
  auditRowSchema,
  noticeSchema,
  noticesResponseSchema,
  tenantDetailResponseSchema,
  tenantSummarySchema,
  tenantsResponseSchema,
} from "@/lib/platform/api";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const AT = "2026-11-15T10:00:00Z";

const summary = {
  id: A,
  name: "Osteria Demo A",
  organisation: { id: B, name: "Gruppo Demo", tenantCount: 1 },
  createdAt: AT,
  members: { owner: 1, admin: 0, chef: 1, waiter: 2 },
  digialtoAttached: false,
  lastActivityDate: "2026-11-14",
};
const row = {
  id: 7,
  at: AT,
  tenantId: A,
  tenantName: "Osteria Demo A",
  action: "console.entered",
  origin: "console",
  detail: { mode: "console", changed: true, sessionsRevoked: 2, slot: null },
};

describe("platform API schemas", () => {
  it("accept the documented examples", () => {
    expect(tenantSummarySchema.parse(summary)).toEqual(summary);
    expect(tenantsResponseSchema.parse({ tenants: [summary] }).tenants).toHaveLength(1);
    expect(auditRowSchema.parse(row)).toEqual(row);
    const detail = { ...summary, timeZone: "Europe/Rome", bookingSlug: null };
    expect(
      tenantDetailResponseSchema.parse({ tenant: detail, activity: [row] }).activity,
    ).toHaveLength(1);
    expect(auditResponseSchema.parse({ rows: [row], nextBefore: null }).nextBefore).toBeNull();
    const notice = {
      id: A,
      kind: "subprocessor",
      version: 1,
      createdAt: AT,
      pending: [{ id: B, name: "Osteria Demo B" }],
      notified: [{ id: A, name: "Osteria Demo A", notifiedAt: AT }],
    };
    expect(noticeSchema.parse(notice)).toEqual(notice);
    expect(noticesResponseSchema.parse({ notices: [notice] }).notices).toHaveLength(1);
  });

  it("refuse an extra key", () => {
    expect(tenantSummarySchema.safeParse({ ...summary, status: "active" }).success).toBe(false);
    expect(auditRowSchema.safeParse({ ...row, extra: 1 }).success).toBe(false);
    expect(
      tenantSummarySchema.safeParse({
        ...summary,
        members: { ...summary.members, guest: 1 },
      }).success,
    ).toBe(false);
  });

  it("refuse a detail value that is an object, and an @ anywhere in detail", () => {
    expect(auditRowSchema.safeParse({ ...row, detail: { mode: { a: 1 } } }).success).toBe(false);
    expect(auditRowSchema.safeParse({ ...row, detail: { kind: "x@example.test" } }).success).toBe(
      false,
    );
  });

  it("refuse an unknown action, an unknown origin and a count below its minimum", () => {
    expect(auditRowSchema.safeParse({ ...row, action: "console.hacked" }).success).toBe(false);
    expect(auditRowSchema.safeParse({ ...row, origin: "migration" }).success).toBe(false);
    const bad = { ...summary, organisation: { ...summary.organisation, tenantCount: 0 } };
    expect(tenantSummarySchema.safeParse(bad).success).toBe(false);
  });

  it("refuse an activity of 11 rows and rows of 51; accept the limits", () => {
    const tenant = { ...summary, timeZone: "Europe/Rome", bookingSlug: "demo" };
    const rows = (n: number) => Array.from({ length: n }, () => row);
    expect(tenantDetailResponseSchema.safeParse({ tenant, activity: rows(10) }).success).toBe(true);
    expect(tenantDetailResponseSchema.safeParse({ tenant, activity: rows(11) }).success).toBe(
      false,
    );
    expect(auditResponseSchema.safeParse({ rows: rows(50), nextBefore: 3 }).success).toBe(true);
    expect(auditResponseSchema.safeParse({ rows: rows(51), nextBefore: 3 }).success).toBe(false);
  });

  it("the audit query needs dal and al, al >= dal, at most 366 days, and no unknown key", () => {
    const ok = { dal: "2026-10-16", al: "2026-11-15" };
    expect(auditQuerySchema.safeParse(ok).success).toBe(true);
    expect(auditQuerySchema.safeParse({ al: ok.al }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ dal: ok.dal }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ dal: "2026-11-15", al: "2026-11-14" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ dal: "2025-11-15", al: "2026-11-16" }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ dal: "2025-11-14", al: "2026-11-16" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ ...ok, azione: "nope" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ ...ok, locale: "x" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ ...ok, limit: 5 }).success).toBe(false);
    expect(
      auditQuerySchema.safeParse({ ...ok, locale: A, azione: "console.left", prima: 9 }).success,
    ).toBe(true);
  });
});
