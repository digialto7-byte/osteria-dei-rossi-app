import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../../helpers/fake-supabase";
import { dbError, ok } from "../../helpers/review-data";
import {
  ALERT_COLUMNS,
  buildAlertList,
  getAlert,
  listAlerts,
  parseAlertCursor,
  parseListAlertsQuery,
  type AlertRow,
} from "@/server/alerts/list";
import { ALERT_LIST_PAGE_SIZE } from "@/server/alerts/constants";

vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const SECRET = "SEGRETO-PAYLOAD-VALUE";
const uuid = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(n: number, overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: uuid(n),
    kind: "test_alert",
    severity: "info",
    entity_type: "tenant",
    entity_id: uuid(900),
    business_date: "2026-10-25",
    created_at: "2026-10-25T00:30:00.123456+00:00",
    payload: {},
    cost_bearing: false,
    acknowledged_at: null,
    acknowledged_by: null,
    acknowledger: null,
    ...overrides,
  };
}

const cursorOf = (r: AlertRow) => `${r.created_at.replace(/\+00:00$/, "Z")}_${r.id}`;
const urlOf = (query = "") => new URL(`http://localhost:3000/api/alerts${query}`);

describe("parseListAlertsQuery", () => {
  it("defaults to the open alerts, no cursor, Italian", () => {
    expect(parseListAlertsQuery(urlOf())).toEqual({ filter: "open", before: null, locale: "it" });
  });

  it("reads filter, locale and a cursor", () => {
    const before = `2026-10-25T00:30:00.123456Z_${uuid(7)}`;
    expect(
      parseListAlertsQuery(urlOf(`?filter=all&locale=en&before=${encodeURIComponent(before)}`)),
    ).toEqual({
      filter: "all",
      locale: "en",
      before: { createdAt: "2026-10-25T00:30:00.123456Z", id: uuid(7) },
    });
  });

  it.each([
    "?filter=x",
    "?locale=fr",
    "?before=nope",
    "?before=2026-10-25_not-an-id",
    "?before=%22",
    "?extra=1",
  ])("rejects %s with 400", (query) => {
    expect(() => parseListAlertsQuery(urlOf(query))).toThrowError(
      expect.objectContaining({ status: 400, code: "invalid_request" }),
    );
  });

  it("parseAlertCursor refuses a cursor with an injected filter", () => {
    expect(parseAlertCursor(`2026-10-25T00:30:00Z,id.gt.0_${uuid(1)}`)).toBeNull();
    expect(parseAlertCursor(`2026-10-25T00:30:00Z"_${uuid(1)}`)).toBeNull();
    expect(parseAlertCursor(`2026-10-25T00:30:00Z_${uuid(1)}"`)).toBeNull();
    expect(parseAlertCursor(`2026-10-25T00:30:00Z_${uuid(1)}`)).not.toBeNull();
  });
});

describe("buildAlertList", () => {
  it("builds items for the owner, who may raise the test alert", () => {
    const list = buildAlertList([row(1)], "owner", "it");
    expect(list.canRaiseTest).toBe(true);
    expect(list.nextCursor).toBeNull();
    expect(list.alerts).toEqual([
      {
        id: uuid(1),
        kind: "test_alert",
        severity: "info",
        entityType: "tenant",
        entityId: uuid(900),
        businessDate: "2026-10-25",
        createdAt: "2026-10-25T00:30:00.123456+00:00",
        title: "Avviso di prova",
        body: "Se leggi questo avviso, gli avvisi funzionano.",
        href: null,
        acknowledged: null,
      },
    ]);
  });

  it("links the three payable reminders to their payable and the digest to the list (M9)", () => {
    const payable = uuid(500);
    const hrefs = (kind: string, entity: string | null, entity_type = "payable") =>
      buildAlertList(
        [row(1, { kind, entity_type, entity_id: entity, cost_bearing: true })],
        "owner",
        "it",
      ).alerts[0]!.href;
    expect(hrefs("payable_due_7d", payable)).toBe(`/pagamenti/${payable}`);
    expect(hrefs("payable_due_today", payable)).toBe(`/pagamenti/${payable}`);
    expect(hrefs("payable_overdue_3d", payable)).toBe(`/pagamenti/${payable}`);
    expect(hrefs("payables_weekly_digest", uuid(900), "tenant")).toBe("/pagamenti");
    expect(hrefs("price_variance", payable)).toBeNull();
    expect(buildAlertList([row(1)], "owner", "it").alerts[0]!.href).toBeNull();
  });

  it("links the five rule alerts to the screen that fixes them (M16)", () => {
    const href = (kind: string) =>
      buildAlertList(
        [row(1, { kind, entity_type: "recipe_key", entity_id: uuid(600) })],
        "owner",
        "it",
      ).alerts[0]!.href;
    expect(href("prep_due")).toBe("/produzione/nuova");
    expect(href("prep_raw_short")).toBe("/produzione/nuova");
    expect(href("purchase_due")).toBe("/riordino/ingredienti");
    expect(href("raw_lot_expiring")).toBe("/magazzino");
    expect(href("batch_expiring")).toBe("/produzione");
  });

  it("gives a reminder without an entity id no link", () => {
    const item = buildAlertList(
      [row(1, { kind: "payable_due_7d", entity_id: null, cost_bearing: true })],
      "owner",
      "it",
    ).alerts[0]!;
    expect(item.href).toBeNull();
  });

  it("a forced payable row is dropped for the chef (cost-bearing)", () => {
    const rows = [
      row(1, { kind: "payable_due_7d", entity_type: "payable", cost_bearing: true }),
      row(2, { kind: "payables_weekly_digest", cost_bearing: true }),
      row(3),
    ];
    expect(buildAlertList(rows, "chef", "it").alerts.map((a) => a.id)).toEqual([uuid(3)]);
    expect(buildAlertList(rows, "owner", "it").alerts).toHaveLength(3);
  });

  it("renders in the requested locale", () => {
    expect(buildAlertList([row(1)], "owner", "en").alerts[0]!.title).toBe("Test alert");
  });

  it("the chef cannot raise the test alert and loses any cost-bearing row (defence in depth)", () => {
    const list = buildAlertList([row(1, { cost_bearing: true }), row(2)], "chef", "it");
    expect(list.canRaiseTest).toBe(false);
    expect(list.alerts.map((a) => a.id)).toEqual([uuid(2)]);
  });

  it("the owner keeps a cost-bearing row", () => {
    expect(buildAlertList([row(1, { cost_bearing: true })], "owner", "it").alerts).toHaveLength(1);
  });

  it("shows who acknowledged only where the join returned a name", () => {
    const at = "2026-10-25T09:12:00+00:00";
    const withName = row(1, {
      acknowledged_at: at,
      acknowledged_by: uuid(50),
      acknowledger: { display_name: "Titolare Demo" },
    });
    const hidden = row(2, { acknowledged_at: at, acknowledged_by: uuid(50), acknowledger: null });
    const { alerts } = buildAlertList([withName, hidden, row(3)], "owner", "it");
    expect(alerts[0]!.acknowledged).toEqual({ at, byName: "Titolare Demo" });
    expect(alerts[1]!.acknowledged).toEqual({ at, byName: null });
    expect(alerts[2]!.acknowledged).toBeNull();
  });

  it("never returns the payload, the cost flag or any payload value", () => {
    const list = buildAlertList(
      [row(1, { payload: { note: SECRET } }), row(2, { kind: "test_alert_kitchen" })],
      "owner",
      "it",
    );
    const json = JSON.stringify(list);
    expect(json).not.toContain(SECRET);
    expect(json).not.toMatch(/payload|cost_bearing|costBearing|acknowledger|display_name/);
  });

  it("51 rows give 50 items and a cursor on the last one shown", () => {
    const rows = Array.from({ length: ALERT_LIST_PAGE_SIZE + 1 }, (_, i) =>
      row(i + 1, { created_at: `2026-10-25T00:00:${String(59 - (i % 60)).padStart(2, "0")}Z` }),
    );
    const list = buildAlertList(rows, "owner", "it");
    expect(list.alerts).toHaveLength(ALERT_LIST_PAGE_SIZE);
    const last = rows[ALERT_LIST_PAGE_SIZE - 1]!;
    expect(list.nextCursor).toBe(cursorOf(last));
  });

  it("the cursor survives a dropped chef row (it follows the raw page, not the filtered one)", () => {
    const rows = Array.from({ length: ALERT_LIST_PAGE_SIZE + 1 }, (_, i) =>
      row(i + 1, { cost_bearing: i === ALERT_LIST_PAGE_SIZE - 1 }),
    );
    const list = buildAlertList(rows, "chef", "it");
    expect(list.alerts).toHaveLength(ALERT_LIST_PAGE_SIZE - 1);
    expect(list.nextCursor).toBe(cursorOf(rows[ALERT_LIST_PAGE_SIZE - 1]!));
  });

  it("an empty page is an empty list", () => {
    expect(buildAlertList([], "owner", "it")).toEqual({
      alerts: [],
      nextCursor: null,
      canRaiseTest: true,
    });
  });
});

describe("listAlerts (query)", () => {
  let client: ReturnType<typeof fakeSupabase>;
  beforeEach(() => {
    client = fakeSupabase({ results: { alert: [ok([row(1)])] } });
  });

  it("reads the newest first, one more than a page, open ones only by default", async () => {
    await listAlerts(client as never, "owner", { filter: "open", before: null, locale: "it" });
    expect(client.from).toHaveBeenCalledWith("alert");
    expect(client.query.select).toHaveBeenCalledWith(ALERT_COLUMNS);
    expect(client.query.is).toHaveBeenCalledWith("acknowledged_at", null);
    expect(client.query.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(client.query.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(client.query.limit).toHaveBeenCalledWith(ALERT_LIST_PAGE_SIZE + 1);
  });

  it("filter=all does not filter on the acknowledgement", async () => {
    await listAlerts(client as never, "owner", { filter: "all", before: null, locale: "it" });
    expect(client.query.is).not.toHaveBeenCalled();
  });

  it("a cursor reads strictly after that (created_at, id)", async () => {
    await listAlerts(client as never, "owner", {
      filter: "all",
      before: { createdAt: "2026-10-25T00:30:00.123456Z", id: uuid(7) },
      locale: "it",
    });
    expect(client.query.or).toHaveBeenCalledWith(
      `created_at.lt."2026-10-25T00:30:00.123456Z",and(created_at.eq."2026-10-25T00:30:00.123456Z",id.lt."${uuid(7)}")`,
    );
  });

  it("quotes the cursor values, also with a numeric zone offset", async () => {
    await listAlerts(client as never, "owner", {
      filter: "all",
      before: { createdAt: "2026-10-25T02:30:00+02:00", id: uuid(7) },
      locale: "it",
    });
    expect(client.query.or).toHaveBeenCalledWith(
      `created_at.lt."2026-10-25T02:30:00+02:00",and(created_at.eq."2026-10-25T02:30:00+02:00",id.lt."${uuid(7)}")`,
    );
  });

  it("a database error becomes an error that names only the SQLSTATE", async () => {
    client = fakeSupabase({ results: { alert: [dbError("57014", `boom ${SECRET}`)] } });
    await expect(
      listAlerts(client as never, "owner", { filter: "open", before: null, locale: "it" }),
    ).rejects.toThrowError("Unexpected database error 57014");
  });
});

describe("listAlerts with names (M12)", () => {
  const ING = "1a000000-0000-4000-8000-00000000001a";
  const LOC = "10000000-0000-4000-8000-0000000000a1";
  const negativeRow = row(5, {
    kind: "negative_stock",
    severity: "warning",
    entity_type: "ingredient",
    entity_id: ING,
    payload: {
      ingredient_id: ING,
      location_id: LOC,
      on_hand_qty: -1,
      unit: "kg",
      movement_id: uuid(77),
    },
  });

  it("renders a negative_stock row for the chef with the names read on the reader's client", async () => {
    const client = fakeSupabase({
      results: {
        alert: [ok([negativeRow, row(1)])],
        ingredient: [ok([{ id: ING, name: "Manzo muscolo (demo)" }])],
        location: [ok([{ id: LOC, name: "Cella (demo)" }])],
      },
    });
    const list = await listAlerts(client as never, "chef", {
      filter: "open",
      before: null,
      locale: "it",
    });
    expect(list.alerts[0]?.title).toBe("Scorta negativa: Manzo muscolo (demo)");
    expect(list.alerts[0]?.body).toContain("Cella (demo)");
    expect(list.alerts[1]?.title).toBe("Avviso di prova");
    expect(JSON.stringify(list)).not.toContain("on_hand_qty");
  });

  it("makes no name query when no row needs a name (other kinds render as before)", async () => {
    const client = fakeSupabase({ results: { alert: [ok([row(1)])] } });
    await listAlerts(client as never, "owner", { filter: "open", before: null, locale: "it" });
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("getAlert resolves names too", async () => {
    const client = fakeSupabase({
      results: {
        alert: [ok(negativeRow)],
        ingredient: [ok([{ id: ING, name: "Manzo muscolo (demo)" }])],
        location: [ok([{ id: LOC, name: "Cella (demo)" }])],
      },
    });
    const item = await getAlert(client as never, uuid(5), "chef", "it");
    expect(item.title).toBe("Scorta negativa: Manzo muscolo (demo)");
  });
});

describe("getAlert", () => {
  it("returns one rendered item", async () => {
    const client = fakeSupabase({ results: { alert: [ok(row(1))] } });
    const item = await getAlert(client as never, uuid(1), "owner", "en");
    expect(item.title).toBe("Test alert");
    expect(client.query.eq).toHaveBeenCalledWith("id", uuid(1));
  });

  it("a row that is not visible is a 404", async () => {
    const client = fakeSupabase({ results: { alert: [ok(null)] } });
    await expect(getAlert(client as never, uuid(1), "owner", "it")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("a cost-bearing row is never shown to the chef", async () => {
    const client = fakeSupabase({ results: { alert: [ok(row(1, { cost_bearing: true }))] } });
    await expect(getAlert(client as never, uuid(1), "chef", "it")).rejects.toMatchObject({
      status: 404,
    });
  });
});
