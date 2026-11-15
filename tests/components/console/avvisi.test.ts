// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_NOTICE_ID,
  DEMO_TENANT_B_ID,
  DEMO_TENANT_ID,
  meReply,
  notice,
} from "./console-fixtures";
import { expectSameFocusedButton, pressRetryHolding } from "./retry-focus";

// SP3 step 18, step 20: Avvisi. Tenant names, versions and dates only; «Segna come avvisato» has no date field.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
type Queued = Reply | "pending";

const calls: { path: string; method: string | undefined; body: unknown }[] = [];
let replies: Record<string, Queued[]> = {};
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, method: init?.method, body: init?.body });
  const next = replies[path]?.shift();
  if (next === "pending") return new Promise(() => undefined);
  return Promise.resolve(next ?? { ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/avvisi",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import { AvvisiScreen } from "@/components/console/avvisi-screen";
import { ConsoleShell } from "@/components/console/console-shell";

const ME = "/api/platform/me";
const TENANTS = "/api/platform/tenants";
const NOTICES = "/api/platform/notices";
const MODE = "/api/platform/console";
const NOTIFIED = `/api/platform/notices/${DEMO_NOTICE_ID}/notified`;
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const ok = (data: unknown): Reply => ({ ok: true, status: 200, data });
const fail = (status: number, code: string): Reply => ({
  ok: false,
  status,
  error: { code, message: "dal server" },
});
const A = { id: DEMO_TENANT_ID, name: "Osteria Demo A" };
const B = { id: DEMO_TENANT_B_ID, name: "Bar Demo" };
const NOTICE_V3 = notice({ id: DEMO_NOTICE_ID, version: 3, pending: [A, B], notified: [] });
const NOTICE_V2 = notice({
  id: "d0000000-0000-4000-8000-00000000000d",
  version: 2,
  pending: [],
  notified: [{ ...A, notifiedAt: "2026-11-10T09:00:00Z" }],
});
// a raw fixture past the schema: a kind this screen has no sentence for
const NOTICE_UNKNOWN = {
  ...notice({ id: "e0000000-0000-4000-8000-00000000000e", version: 4, pending: [A] }),
  kind: "future_kind",
};

function setup(notices: unknown[] = [NOTICE_V3, NOTICE_V2], unread = 1) {
  replies[ME] = [ok(meReply({ unreadNotices: unread }))];
  replies[TENANTS] = [ok({ tenants: [] })];
  replies[NOTICES] = [ok({ notices })];
}
const mount = () => render(createElement(ConsoleShell, null, createElement(AvvisiScreen)));
const count = (path: string) => calls.filter((c) => c.path === path).length;
const items = () => within(screen.getByRole("tabpanel")).getAllByRole("listitem");
const sentences = () =>
  within(screen.getByRole("tabpanel")).queryAllByText(/^Nuovo sub-responsabile/);
// The tabpanel is always mounted, so «loaded» is the READY state: no «Caricamento…», no error to retry, and a list or an empty text in it.
const loaded = () =>
  waitFor(() => {
    expect(screen.queryByText("Caricamento…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).queryAllByRole("listitem").length +
        within(panel).queryAllByText(/^Nessun avviso/).length,
    ).toBeGreaterThan(0);
  });
const markButtons = () => screen.queryAllByRole("button", { name: "Segna come avvisato" });

beforeEach(() => {
  calls.length = 0;
  replies = {};
  apiJson.mockClear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
  Object.defineProperty(window, "location", {
    value: { assign: vi.fn(), reload: vi.fn(), replace: vi.fn(), pathname: "/avvisi", search: "" },
    configurable: true,
  });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
});

describe("Avvisi: the tabs", () => {
  it("the «Da leggere» tab shows «Nuovo sub-responsabile v3: 2 locali non ancora avvisati»", async () => {
    setup();
    mount();
    expect(
      await screen.findByText("Nuovo sub-responsabile v3: 2 locali non ancora avvisati"),
    ).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Avvisi" })).toBeTruthy();
    expect(calls.filter((c) => c.path === NOTICES)).toEqual([
      { path: NOTICES, method: undefined, body: undefined },
    ]);
  });

  it("has the house tabs «Da leggere» and «Letti», the first selected", async () => {
    setup();
    mount();
    await loaded();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Da leggere", "Letti"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
  });

  it("a notice with no one pending is under «Letti» only", async () => {
    setup();
    mount();
    await loaded();
    expect(sentences().map((s) => s.textContent)).toEqual([
      "Nuovo sub-responsabile v3: 2 locali non ancora avvisati",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Letti" }));
    expect(sentences().map((s) => s.textContent)).toEqual([
      "Nuovo sub-responsabile v2: tutti i locali avvisati",
    ]);
    expect(screen.getByText("Avvisato il 10 nov 2026, 10:00")).toBeTruthy();
    expect(markButtons()).toEqual([]);
  });

  it("shows the creation time of each notice", async () => {
    setup([notice({ pending: [A], createdAt: "2026-11-14T08:40:00Z" })]);
    mount();
    expect(await screen.findByText("creato il 14 nov 2026, 09:40")).toBeTruthy();
  });

  it("an unknown kind shows its code, and every notice shows its kind in small text", async () => {
    setup([NOTICE_UNKNOWN, NOTICE_V3]);
    mount();
    await loaded();
    const row = items()[0]!;
    expect(within(row).getByText("future_kind")).toBeTruthy();
    expect(within(row).getByText("codice: future_kind")).toBeTruthy();
    expect(screen.getByText("codice: subprocessor")).toBeTruthy();
  });

  it("says so when nothing is to read, and when nothing is read", async () => {
    setup([]);
    mount();
    expect(await screen.findByText("Nessun avviso da leggere.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Letti" }));
    expect(screen.getByText("Nessun avviso letto.")).toBeTruthy();
  });
});

describe("Avvisi: «Segna come avvisato»", () => {
  it("each pending row has the secondary button and the page has no date field", async () => {
    setup([NOTICE_V3]);
    const { container } = mount();
    await loaded();
    const buttons = markButtons();
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b.className).toContain("border-ink");
      expect(b.className).not.toContain("bg-accent");
      expect(b.className).toContain("min-h-tap");
    }
    expect(container.querySelector("input")).toBeNull();
    expect(screen.getByText("Osteria Demo A")).toBeTruthy();
    expect(screen.getByText("Bar Demo")).toBeTruthy();
  });

  it("a click posts {tenantId} to /api/platform/notices/<id>/notified; the row then shows the reply's date and /me is read once more", async () => {
    setup([NOTICE_V3]);
    replies[NOTIFIED] = [ok({ notifiedAt: "2026-11-15T09:00:00Z", changed: true })];
    replies[ME]!.push(ok(meReply({ unreadNotices: 1 })));
    mount();
    await loaded();
    expect(count(ME)).toBe(1);
    fireEvent.click(markButtons()[0]!);
    expect(await screen.findByText("Avvisato il 15 nov 2026, 10:00")).toBeTruthy();
    expect(calls.filter((c) => c.path === NOTIFIED)).toEqual([
      { path: NOTIFIED, method: "POST", body: { tenantId: DEMO_TENANT_ID } },
    ]);
    await waitFor(() => expect(count(ME)).toBe(2));
    expect(count(TENANTS)).toBe(1);
    // the other row is untouched; the notice stays where it is until the next read
    expect(markButtons()).toHaveLength(1);
    expect(sentences()).toHaveLength(1);
  });

  it("changed: false shows the same line", async () => {
    setup([NOTICE_V3]);
    replies[NOTIFIED] = [ok({ notifiedAt: "2026-11-12T09:00:00Z", changed: false })];
    mount();
    await loaded();
    fireEvent.click(markButtons()[1]!);
    expect(await screen.findByText("Avvisato il 12 nov 2026, 10:00")).toBeTruthy();
    expect((replies[NOTIFIED] ?? []).length).toBe(0);
  });

  it("the button is off while the request is open", async () => {
    setup([NOTICE_V3]);
    replies[NOTIFIED] = ["pending"];
    mount();
    await loaded();
    fireEvent.click(markButtons()[0]!);
    await waitFor(() => expect((markButtons()[0] as HTMLButtonElement).disabled).toBe(true));
    expect((markButtons()[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it("a 404 shows an error on the row and keeps the button", async () => {
    setup([NOTICE_V3]);
    replies[NOTIFIED] = [fail(404, "notice_not_found")];
    mount();
    await loaded();
    fireEvent.click(markButtons()[0]!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Non riesco a segnare questo locale come avvisato.");
    expect(items()[0]!.contains(alert) || screen.getByRole("tabpanel").contains(alert)).toBe(true);
    expect(markButtons()).toHaveLength(2);
    expect(count(ME)).toBe(1);
  });

  it("the error clears when the person tries again, and a failed switch can post again", async () => {
    setup([NOTICE_V3]);
    replies[NOTIFIED] = [fail(409, "console_selection_required")];
    mount();
    await loaded();
    // the reads above succeeded and cleared the guard; a reload that did not bring console mode sets it again
    sessionStorage.setItem("costi.console.switching", "1");
    fireEvent.click(markButtons()[0]!);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La console non risponde. Riprova tra poco.",
    );
    expect(count(MODE)).toBe(0);
    replies[NOTIFIED] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    fireEvent.click(markButtons()[0]!);
    await waitFor(() => expect(count(MODE)).toBe(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Avvisi: the tabpanel is always there", () => {
  // aria-controls on each tab must point at an element that exists, in every state
  const controlled = () => {
    const ids = screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-controls"));
    expect(new Set(ids).size).toBe(1);
    const panel = document.getElementById(ids[0]!);
    expect(panel?.getAttribute("role")).toBe("tabpanel");
    return panel!;
  };

  it("holds «Caricamento…» while the read is open", () => {
    replies[ME] = [ok(meReply())];
    replies[TENANTS] = [ok({ tenants: [] })];
    replies[NOTICES] = ["pending"];
    mount();
    expect(within(controlled()).getByText("Caricamento…")).toBeTruthy();
  });

  it("holds the read error", async () => {
    setup();
    replies[NOTICES] = [fail(400, "invalid_request")];
    mount();
    await screen.findByText("Non riesco a leggere gli avvisi.");
    expect(within(controlled()).getByRole("button", { name: "Riprova" })).toBeTruthy();
  });

  it("holds the empty text", async () => {
    setup([]);
    mount();
    await screen.findByText("Nessun avviso da leggere.");
    expect(within(controlled()).getByText("Nessun avviso da leggere.")).toBeTruthy();
  });

  it("holds the list, labelled by the selected tab", async () => {
    setup();
    mount();
    await screen.findByText("Nuovo sub-responsabile v3: 2 locali non ancora avvisati");
    const panel = controlled();
    expect(within(panel).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(panel.getAttribute("aria-labelledby")).toBe(screen.getAllByRole("tab")[0]!.id);
  });
});

describe("Avvisi: «Riprova» keeps focus", () => {
  it("through a retry that fails again", async () => {
    setup();
    replies[NOTICES] = [fail(400, "invalid_request")];
    mount();
    await screen.findByText("Non riesco a leggere gli avvisi.");
    const { button, answer } = pressRetryHolding(apiJson);
    expect(screen.getByText("Non riesco a leggere gli avvisi.")).toBeTruthy();
    await answer(fail(400, "invalid_request"));
    expect(screen.getByText("Non riesco a leggere gli avvisi.")).toBeTruthy();
    expectSameFocusedButton(button);
  });

  it("through a retry that succeeds, and then the error goes", async () => {
    setup();
    replies[NOTICES] = [fail(400, "invalid_request")];
    mount();
    await screen.findByText("Non riesco a leggere gli avvisi.");
    const { answer } = pressRetryHolding(apiJson);
    await answer(ok({ notices: [NOTICE_V3] }));
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
    expect(
      screen.getByText("Nuovo sub-responsabile v3: 2 locali non ancora avvisati"),
    ).toBeTruthy();
  });
});

describe("Avvisi: states", () => {
  it("shows «Caricamento…» while the read is open", () => {
    replies[ME] = [ok(meReply())];
    replies[TENANTS] = [ok({ tenants: [] })];
    replies[NOTICES] = ["pending"];
    mount();
    expect(screen.getByText("Caricamento…")).toBeTruthy();
  });

  it("a failed read shows «Non riesco a leggere gli avvisi.» and «Riprova» reads again", async () => {
    setup();
    replies[NOTICES] = [fail(400, "invalid_request"), ok({ notices: [NOTICE_V3] })];
    mount();
    expect(await screen.findByText("Non riesco a leggere gli avvisi.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(
      await screen.findByText("Nuovo sub-responsabile v3: 2 locali non ancora avvisati"),
    ).toBeTruthy();
    expect(screen.queryByText("Non riesco a leggere gli avvisi.")).toBeNull();
    expect(count(NOTICES)).toBe(2);
  });

  it("«Riprova» after console_unavailable posts /api/platform/console again", async () => {
    sessionStorage.setItem("costi.console.switching", "1");
    replies[ME] = [fail(409, "console_selection_required")];
    replies[TENANTS] = [fail(409, "console_selection_required")];
    replies[NOTICES] = [fail(409, "console_selection_required")];
    mount();
    expect(await screen.findByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
    expect(count(MODE)).toBe(0);
    replies[NOTICES] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await waitFor(() => expect(count(MODE)).toBe(1));
  });

  it("keeps «Caricamento…» and no error while the page is being left", async () => {
    replies[ME] = [fail(409, "console_selection_required")];
    replies[TENANTS] = [fail(409, "console_selection_required")];
    replies[NOTICES] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    mount();
    await waitFor(() => expect(count(MODE)).toBe(1));
    expect(screen.getByText("Caricamento…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("makes no read on a timer", async () => {
    setup();
    mount();
    await loaded();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(count(NOTICES)).toBe(1);
    expect(count(ME)).toBe(1);
  });

  it("holds only tenant names: no e-mail address anywhere", async () => {
    setup();
    const { container } = mount();
    await loaded();
    expect(container.innerHTML).not.toContain("@");
  });
});
