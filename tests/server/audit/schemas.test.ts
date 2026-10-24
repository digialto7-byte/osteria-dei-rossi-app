import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { parseAuditQuery } from "@/server/audit/schemas";

const ID = "51000000-0000-4000-8000-000000000001";
const url = (query = "") => new URL(`http://localhost:3000/api/audit${query}`);

describe("parseAuditQuery", () => {
  it("defaults to every kind, no dates (the service applies the Rome month) and the first page", () => {
    expect(parseAuditQuery(url())).toEqual({ from: null, to: null, kind: "all", before: null });
  });

  it("reads dates, kind and the cursor", () => {
    const before = `2026-10-23T10:12:00.5+00:00_${ID}`;
    expect(
      parseAuditQuery(
        url(`?from=2026-10-01&to=2026-10-23&kind=stock&before=${encodeURIComponent(before)}`),
      ),
    ).toEqual({
      from: "2026-10-01",
      to: "2026-10-23",
      kind: "stock",
      before: { at: "2026-10-23T10:12:00.5+00:00", id: ID },
    });
  });

  it("takes the three kinds", () => {
    for (const kind of ["all", "stock", "events"]) {
      expect(parseAuditQuery(url(`?kind=${kind}`)).kind).toBe(kind);
    }
  });

  it.each([
    "?kind=x",
    "?from=2026-02-30",
    "?to=today",
    "?before=nope",
    `?before=${encodeURIComponent("2026-10-23T10:12:00Z_" + ID + "'")}`,
    "?limit=5",
    "?kind=stock&kind=events",
  ])("answers 400 for %s", (query) => {
    expect(() => parseAuditQuery(url(query))).toThrow(ApiError);
    try {
      parseAuditQuery(url(query));
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
    }
  });
});
