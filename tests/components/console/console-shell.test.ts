// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meReply, tenantSummary, DEMO_TENANT_B_ID } from "./console-fixtures";

// SP3 step 18, step 16: the console shell. It reads /me and /tenants once on mount, shares them, and draws the band, the sidebar and the pills.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const calls: { path: string; method: string | undefined; body: unknown }[] = [];
let replies: Record<string, Reply[]> = {};
const defaultReply = (path: string): Reply => ({
  ok: true,
  status: 200,
  data:
    path === "/api/platform/tenants"
      ? { tenants: [] }
      : path === "/api/platform/me"
        ? { displayName: "DigiAlto", unreadNotices: 0 }
        : {},
});
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, method: init?.method, body: init?.body });
  return Promise.resolve(replies[path]?.shift() ?? defaultReply(path));
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));
let pathname = "/";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), push }),
}));

import { ConsoleShell, useConsoleShell } from "@/components/console/console-shell";

const ME = "/api/platform/me";
const TENANTS = "/api/platform/tenants";
const MODE = "/api/platform/console";
const LOGOUT = "/api/platform/logout";
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const assign = vi.fn();
const reload = vi.fn();
const locationReplace = vi.fn();

const ok = (data: unknown): Reply => ({ ok: true, status: 200, data });
const fail = (status: number, code: string): Reply => ({
  ok: false,
  status,
  error: { code, message: "dal server" },
});
const two = [
  tenantSummary(),
  tenantSummary({ id: DEMO_TENANT_B_ID, name: "Bar Demo", lastActivityDate: null }),
];
function happy() {
  replies[ME] = [ok(meReply({ unreadNotices: 1 }))];
  replies[TENANTS] = [ok({ tenants: two })];
}
const count = (path: string) => calls.filter((c) => c.path === path).length;

function Probe() {
  const shell = useConsoleShell();
  return createElement(
    "div",
    null,
    createElement("button", { onClick: shell.refreshMe }, "rileggi-me"),
    createElement("button", { onClick: shell.retryTenants }, "rileggi-locali"),
    createElement("p", { "data-testid": "tenants" }, shell.tenants.kind),
    createElement("p", { "data-testid": "me" }, shell.me.kind),
  );
}
const mount = (strict = false) => {
  const tree = createElement(ConsoleShell, null, createElement(Probe));
  return render(strict ? createElement(StrictMode, null, tree) : tree);
};
const sidebar = () => screen.getByTestId("console-sidebar");
const pills = () => screen.getByTestId("console-pills");

beforeEach(() => {
  calls.length = 0;
  replies = {};
  pathname = "/";
  apiJson.mockClear();
  push.mockClear();
  assign.mockClear();
  reload.mockClear();
  locationReplace.mockClear();
  sessionStorage.clear();
  Object.defineProperty(window, "location", {
    value: { assign, reload, replace: locationReplace, pathname: "/", search: "" },
    configurable: true,
  });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
});

describe("the reads", () => {
  it("on mount reads /api/platform/me and /api/platform/tenants exactly once each", async () => {
    happy();
    mount();
    await waitFor(() => expect(screen.getByTestId("tenants").textContent).toBe("ready"));
    expect(count(ME)).toBe(1);
    expect(count(TENANTS)).toBe(1);
    expect(calls.every((c) => c.method === undefined || c.method === "GET")).toBe(true);
  });

  it("reads once each under StrictMode too", async () => {
    happy();
    mount(true);
    await waitFor(() => expect(screen.getByTestId("me").textContent).toBe("ready"));
    expect(count(ME)).toBe(1);
    expect(count(TENANTS)).toBe(1);
  });

  it("there is no polling: ten minutes and a visibility change later, still one call each", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    happy();
    mount();
    await waitFor(() => expect(screen.getByTestId("me").textContent).toBe("ready"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(count(ME)).toBe(1);
    expect(count(TENANTS)).toBe(1);
  });

  it("refreshMe reads /me once more and the tenant list not at all", async () => {
    happy();
    replies[ME]!.push(ok(meReply({ unreadNotices: 0 })));
    mount();
    await waitFor(() =>
      expect(within(sidebar()).getByRole("link", { name: "Avvisi 1" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "rileggi-me" }));
    await waitFor(() =>
      expect(within(sidebar()).getByRole("link", { name: "Avvisi 0" })).toBeTruthy(),
    );
    expect(count(ME)).toBe(2);
    expect(count(TENANTS)).toBe(1);
  });

  it("a 409 console_selection_required on both reads posts one /api/platform/console", async () => {
    replies[ME] = [fail(409, "console_selection_required")];
    replies[TENANTS] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    mount();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(count(MODE)).toBe(1);
    // leaving: the shell keeps loading, it never flashes an error
    expect(screen.getByTestId("tenants").textContent).toBe("loading");
    expect(screen.getByTestId("me").textContent).toBe("loading");
  });

  it("retryTenants clears the switch guard first, so a failed switch can post again", async () => {
    sessionStorage.setItem("costi.console.switching", "1");
    replies[ME] = [fail(409, "console_selection_required")];
    replies[TENANTS] = [fail(409, "console_selection_required")];
    mount();
    await waitFor(() => expect(screen.getByTestId("tenants").textContent).toBe("error"));
    expect(count(MODE)).toBe(0);
    replies[TENANTS] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    fireEvent.click(screen.getByRole("button", { name: "rileggi-locali" }));
    await waitFor(() => expect(count(MODE)).toBe(1));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("retryTenants reads /me again only when it had failed", async () => {
    replies[ME] = [fail(503, "console_switch_failed")];
    replies[TENANTS] = [fail(503, "console_switch_failed")];
    mount();
    await waitFor(() => expect(screen.getByTestId("me").textContent).toBe("error"));
    happy();
    fireEvent.click(screen.getByRole("button", { name: "rileggi-locali" }));
    await waitFor(() => expect(screen.getByTestId("tenants").textContent).toBe("ready"));
    expect(screen.getByTestId("me").textContent).toBe("ready");
    expect(count(ME)).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "rileggi-locali" }));
    await waitFor(() => expect(count(TENANTS)).toBe(3));
    expect(count(ME)).toBe(2);
  });
});

describe("the sidebar", () => {
  it("shows «Locali 2», «Registro» and «Avvisi 1»", async () => {
    happy();
    mount();
    const nav = within(sidebar());
    await waitFor(() => expect(nav.getByRole("link", { name: "Locali 2" })).toBeTruthy());
    expect(nav.getByRole("link", { name: "Avvisi 1" })).toBeTruthy();
    expect(nav.getByRole("link", { name: "Registro" })).toBeTruthy();
    expect(nav.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/registro",
      "/avvisi",
    ]);
  });

  it("shows no count while loading", () => {
    mount();
    const nav = within(sidebar());
    expect(nav.getByRole("link", { name: "Locali" })).toBeTruthy();
    expect(nav.getByRole("link", { name: "Avvisi" })).toBeTruthy();
  });

  it("shows no count after an error", async () => {
    replies[ME] = [fail(500, "internal")];
    replies[TENANTS] = [fail(500, "internal")];
    mount();
    await waitFor(() => expect(screen.getByTestId("me").textContent).toBe("error"));
    expect(within(sidebar()).getByRole("link", { name: "Locali" })).toBeTruthy();
    expect(within(sidebar()).getByRole("link", { name: "Avvisi" })).toBeTruthy();
  });

  it("the footer shows the display name, «Verifica in due passaggi attiva» and «Orari: ora italiana»", async () => {
    happy();
    mount();
    await waitFor(() => expect(within(sidebar()).getByText("DigiAlto")).toBeTruthy());
    expect(within(sidebar()).getByText("Verifica in due passaggi attiva")).toBeTruthy();
    expect(within(sidebar()).getByText("Orari: ora italiana")).toBeTruthy();
  });

  it("the footer shows no name until /me has answered", () => {
    mount();
    expect(within(sidebar()).queryByText("DigiAlto")).toBeNull();
    expect(within(sidebar()).getByText("Verifica in due passaggi attiva")).toBeTruthy();
  });

  it("marks the current section with aria-current=page, and the venue detail counts as Locali", () => {
    for (const [path, name] of [
      ["/", "Locali"],
      ["/locali/a0000000-0000-4000-8000-00000000000a", "Locali"],
      ["/registro", "Registro"],
      ["/avvisi", "Avvisi"],
    ] as const) {
      pathname = path;
      const view = mount();
      const current = within(sidebar())
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "page");
      expect(current.map((a) => a.textContent)).toEqual([name]);
      view.unmount();
    }
  });

  it("is only for laptops: hidden below lg", () => {
    mount();
    expect(sidebar().className).toMatch(/\bhidden\b/);
    expect(sidebar().className).toMatch(/lg:flex/);
  });

  it("every link is a 44 px target", () => {
    mount();
    for (const a of [
      ...within(sidebar()).getAllByRole("link"),
      ...within(pills()).getAllByRole("link"),
    ])
      expect(a.className).toContain("min-h-tap");
  });
});

describe("the pills", () => {
  it("carry the same links and counts, and are hidden from lg up", async () => {
    happy();
    pathname = "/registro";
    mount();
    const nav = within(pills());
    await waitFor(() => expect(nav.getByRole("link", { name: "Locali 2" })).toBeTruthy());
    expect(nav.getByRole("link", { name: "Avvisi 1" })).toBeTruthy();
    expect(nav.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/registro",
      "/avvisi",
    ]);
    expect(nav.getByRole("link", { name: "Registro" }).getAttribute("aria-current")).toBe("page");
    expect(pills().className).toContain("lg:hidden");
  });

  it("the phone shows «Orari: ora italiana» once, outside the sidebar", () => {
    mount();
    const phone = screen.getByTestId("console-times");
    expect(phone.textContent).toBe("Orari: ora italiana");
    expect(phone.className).toContain("lg:hidden");
    expect(sidebar().contains(phone)).toBe(false);
  });
});

describe("the frame", () => {
  it("renders the band «Costì · Console» with «Esci», one main, and the children", () => {
    const { container } = mount();
    expect(container.querySelector("header")!.textContent).toBe("Costì · ConsoleEsci");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("main")!.contains(screen.getByTestId("tenants"))).toBe(true);
    expect(container.querySelector("[data-layout=wide]")).not.toBeNull();
  });

  it("«Esci» in the band posts /api/platform/logout and goes to /login", async () => {
    const { container } = mount();
    fireEvent.click(
      within(container.querySelector("header")!).getByRole("button", { name: "Esci" }),
    );
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/login"));
    expect(calls.filter((c) => c.path === LOGOUT)).toEqual([
      { path: LOGOUT, method: "POST", body: {} },
    ]);
  });

  it("has no e-mail address anywhere in the page", async () => {
    happy();
    const { container } = mount();
    await waitFor(() => expect(screen.getByTestId("me").textContent).toBe("ready"));
    expect(container.innerHTML).not.toContain("@");
  });
});

describe("useConsoleShell", () => {
  it("throws outside the shell", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(createElement(Probe))).toThrow(/ConsoleShell/);
    spy.mockRestore();
  });
});
