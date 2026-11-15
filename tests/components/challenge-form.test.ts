// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P2-1 B3: the sign-in code page /login/codice. It reads GET /api/me/mfa, posts {factorId, code, next} and follows the reply's redirect.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

const P = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";
const f = (id: string, slot: string, status = "verified") => ({
  id,
  slot,
  status,
  createdAt: "2026-11-12T10:00:00.000Z",
});
const status = (over: Record<string, unknown> = {}): Reply => ({
  ok: true,
  status: 200,
  data: {
    role: "owner",
    mode: "enrolled",
    gate: "challenge",
    currentLevel: "aal1",
    factors: [f(P, "principale")],
    canAddFactor: true,
    lockedUntil: null,
    ...over,
  },
});

const calls: { path: string; method: string | undefined; body: unknown }[] = [];
let replies: Record<string, Reply[]> = {};
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, method: init?.method, body: init?.body });
  return Promise.resolve(replies[path]?.shift() ?? { ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const forgetUser = vi.fn();
vi.mock("@/components/forget-user", () => ({ forgetUser: () => forgetUser() }));
vi.mock("@/pwa/use-outbox", () => ({ useSyncView: () => ({ mine: 0 }) }));

import { ChallengeForm } from "@/app/(public)/login/codice/challenge-form";
import ChallengePage from "@/app/(public)/login/codice/page";

const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const verifyOk: Reply = { ok: true, status: 200, data: { redirect: "/oggi" } };
beforeEach(() => {
  calls.length = 0;
  replies = { "/api/me/mfa": [status()], "/api/auth/mfa/challenge": [verifyOk] };
  apiJson.mockClear();
  replace.mockClear();
  forgetUser.mockClear();
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
  vi.useRealTimers();
});

const mount = (next: string | undefined = "/oggi") =>
  render(createElement(ChallengeForm, { next }));
const field = async () => (await screen.findByLabelText("Codice di 6 cifre")) as HTMLInputElement;
const verify = () => screen.getByRole("button", { name: "Verifica" }) as HTMLButtonElement;
const enter = async (code: string) => {
  fireEvent.change(await field(), { target: { value: code } });
  fireEvent.click(verify());
};

describe("ChallengeForm", () => {
  it("reads the status first, then shows the title, the intro and a numeric one-time-code field", async () => {
    mount();
    const input = await field();
    expect(calls[0]).toEqual({ path: "/api/me/mfa", method: undefined, body: undefined });
    expect(
      screen.getByText("Apri l'app di autenticazione e scrivi il codice di 6 cifre."),
    ).toBeTruthy();
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.maxLength).toBe(6);
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("Verifica is disabled until six digits are typed", async () => {
    mount();
    const input = await field();
    expect(verify().disabled).toBe(true);
    fireEvent.change(input, { target: { value: "12ab3456" } });
    expect(input.value).toBe("123456");
    expect(verify().disabled).toBe(false);
  });

  it("posts {factorId, code, next}, forgets the cached user and follows the reply's redirect", async () => {
    mount("/fatture");
    await enter("123456");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/oggi"));
    expect(calls[1]).toEqual({
      path: "/api/auth/mfa/challenge",
      method: "POST",
      body: { factorId: P, code: "123456", next: "/fatture" },
    });
    expect(forgetUser).toHaveBeenCalledTimes(1);
  });

  it("an unsafe next is sent as /", async () => {
    mount("https://evil.test/");
    await enter("123456");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1]!.body as { next: string }).next).toBe("/");
  });

  it("one verified factor: no choice is offered", async () => {
    mount();
    await field();
    expect(screen.queryByRole("button", { name: "Usa il dispositivo di riserva" })).toBeNull();
  });

  it("two verified factors: the backup button switches the factorId sent, and back", async () => {
    replies["/api/me/mfa"] = [
      status({ factors: [f(R, "riserva"), f(P, "principale"), f(U, "riserva", "unverified")] }),
    ];
    mount();
    await field();
    fireEvent.click(screen.getByRole("button", { name: "Usa il dispositivo di riserva" }));
    await enter("111111");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1]!.body as { factorId: string }).factorId).toBe(R);
    expect(screen.getByRole("button", { name: "Usa il dispositivo principale" })).toBeTruthy();
  });

  it("two verified factors, no switch: the main device's id is sent", async () => {
    replies["/api/me/mfa"] = [status({ factors: [f(R, "riserva"), f(P, "principale")] })];
    mount();
    await enter("111111");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1]!.body as { factorId: string }).factorId).toBe(P);
  });

  it("a wrong code is announced, the field cleared and focused", async () => {
    replies["/api/auth/mfa/challenge"] = [
      { ok: false, status: 422, error: { code: "mfa_code_invalid", message: "s" } },
    ];
    mount();
    await enter("123456");
    const message = await screen.findByText(
      "Codice non valido. Controlla che l'ora del telefono sia giusta e riprova.",
    );
    expect(message.closest("[aria-live]")?.getAttribute("aria-live")).toBe("assertive");
    expect((await field()).value).toBe("");
    expect(document.activeElement).toBe(await field());
    expect(replace).not.toHaveBeenCalled();
  });

  it("an expired challenge", async () => {
    replies["/api/auth/mfa/challenge"] = [
      { ok: false, status: 422, error: { code: "mfa_challenge_expired", message: "s" } },
    ];
    mount();
    await enter("123456");
    expect(await screen.findByText("Il codice è scaduto. Riprova.")).toBeTruthy();
  });

  it("a lock from the server names the minutes and disables the field", async () => {
    replies["/api/auth/mfa/challenge"] = [
      {
        ok: false,
        status: 429,
        error: { code: "mfa_locked", message: "s", details: { retryAfterSeconds: 720 } },
      },
    ];
    mount();
    await enter("123456");
    expect(await screen.findByText("Troppi tentativi. Riprova tra 12 minuti.")).toBeTruthy();
    expect((await field()).disabled).toBe(true);
    expect(verify().disabled).toBe(true);
  });

  it("a lockedUntil in the status disables the field at once, with the minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00.000Z"));
    replies["/api/me/mfa"] = [status({ lockedUntil: "2026-11-12T10:12:00.000Z" })];
    mount();
    expect(await screen.findByText("Troppi tentativi. Riprova tra 12 minuti.")).toBeTruthy();
    expect((await field()).disabled).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("a lockedUntil already past is no lock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00.000Z"));
    replies["/api/me/mfa"] = [status({ lockedUntil: "2026-11-12T09:00:00.000Z" })];
    mount();
    expect((await field()).disabled).toBe(false);
  });

  it("a rate limit from Supabase shows the server's message and keeps the field usable", async () => {
    replies["/api/auth/mfa/challenge"] = [
      {
        ok: false,
        status: 429,
        error: { code: "rate_limited", message: "Troppe richieste, riprova tra poco." },
      },
    ];
    mount();
    await enter("123456");
    expect(await screen.findByText("Troppe richieste, riprova tra poco.")).toBeTruthy();
    expect((await field()).disabled).toBe(false);
  });

  it("Esci posts /api/auth/logout", async () => {
    Object.defineProperty(window, "location", { value: { replace: vi.fn() }, configurable: true });
    mount();
    await field();
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    await waitFor(() => expect(calls.map((c) => c.path)).toContain("/api/auth/logout"));
  });

  it("gate ok goes straight to next, with no form", async () => {
    replies["/api/me/mfa"] = [status({ gate: "ok", currentLevel: "aal2" })];
    mount("/fatture");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fatture"));
    expect(screen.queryByLabelText("Codice di 6 cifre")).toBeNull();
  });

  it("gate ok with next=/doppia-verifica loads that QR page as a new document, with no router replace (T-12)", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
    replies["/api/me/mfa"] = [status({ gate: "ok", currentLevel: "aal2" })];
    mount("/doppia-verifica");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/doppia-verifica"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("a verify reply whose redirect is /doppia-verifica loads it as a new document, with no router replace (T-12)", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
    replies["/api/auth/mfa/challenge"] = [
      { ok: true, status: 200, data: { redirect: "/doppia-verifica" } },
    ];
    mount("/doppia-verifica");
    await enter("123456");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/doppia-verifica"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("gate enrol loads the forced enrolment page as a new document (its CSP allows the QR), with the way back", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
    replies["/api/me/mfa"] = [status({ gate: "enrol", factors: [] })];
    mount("/fatture?x=1");
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/login/attiva-codice?next=%2Ffatture%3Fx%3D1"),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("when the lock ends the focus returns to the code field", async () => {
    replies["/api/me/mfa"] = [status({ lockedUntil: new Date(Date.now() + 1000).toISOString() })];
    mount();
    const input = await field();
    expect(input.disabled).toBe(true);
    await waitFor(() => expect(input.disabled).toBe(false), { timeout: 3000 });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("a status that cannot be read shows its message and still offers Esci", async () => {
    replies["/api/me/mfa"] = [
      {
        ok: false,
        status: 401,
        error: { code: "unauthorized", message: "Accedi per continuare." },
      },
    ];
    mount();
    expect(await screen.findByText("Accedi per continuare.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Esci" })).toBeTruthy();
  });

  it("makes every button a 44 px target", async () => {
    replies["/api/me/mfa"] = [status({ factors: [f(P, "principale"), f(R, "riserva")] })];
    mount();
    await field();
    for (const button of screen.getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("min-h-tap");
    }
  });

  it("never writes the code to storage or the address", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mount();
    await enter("123456");
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain("123456");
    setItem.mockRestore();
  });
});

describe("the page", () => {
  it("renders the heading and passes the next path to the form", async () => {
    render(await ChallengePage({ searchParams: Promise.resolve({ next: "/magazzino" }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Codice di verifica" })).toBeTruthy();
    await enter("123456");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1]!.body as { next: string }).next).toBe("/magazzino");
  });
});

// SP3 step 18 (L11): a platform account opened on the venue host has no venue, so GET /api/me/mfa answers 403 no_tenant or 409
// tenant_selection_required. Only then does the form read and post the account pair, /api/auth/mfa/account.
describe("ChallengeForm, the account fallback", () => {
  const noTenant: Reply = {
    ok: false,
    status: 403,
    error: { code: "no_tenant", message: "Nessun locale." },
  };
  const selection: Reply = {
    ok: false,
    status: 409,
    error: { code: "tenant_selection_required", message: "Scegli il locale." },
  };
  const account = (over: Record<string, unknown> = {}): Reply => ({
    ok: true,
    status: 200,
    data: {
      factors: [{ id: P, slot: "principale", status: "verified" }],
      currentLevel: "aal1",
      canAddFactor: true,
      lockedUntil: null,
      ...over,
    },
  });
  const accountFail = (status: number, code: string, message: string): Reply => ({
    ok: false,
    status,
    error: { code, message },
  });
  const paths = () => calls.map((c) => c.path);

  beforeEach(() => {
    replies["/api/auth/mfa/account"] = [account()];
  });

  it("a 403 no_tenant from GET /api/me/mfa reads GET /api/auth/mfa/account and shows the code field", async () => {
    replies["/api/me/mfa"] = [noTenant];
    mount();
    expect(await field()).toBeTruthy();
    expect(calls.slice(0, 2)).toEqual([
      { path: "/api/me/mfa", method: undefined, body: undefined },
      { path: "/api/auth/mfa/account", method: undefined, body: undefined },
    ]);
    expect(screen.queryByText("Nessun locale.")).toBeNull();
  });

  it("a 409 tenant_selection_required does the same", async () => {
    replies["/api/me/mfa"] = [selection];
    mount();
    expect(await field()).toBeTruthy();
    expect(paths()).toEqual(["/api/me/mfa", "/api/auth/mfa/account"]);
  });

  it("posts {factorId, code, next} to /api/auth/mfa/account and follows the reply's redirect", async () => {
    replies["/api/me/mfa"] = [noTenant];
    replies["/api/auth/mfa/account"]!.push({ ok: true, status: 200, data: { redirect: "/" } });
    mount("/oggi");
    await enter("123456");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(calls[2]).toEqual({
      path: "/api/auth/mfa/account",
      method: "POST",
      body: { factorId: P, code: "123456", next: "/oggi" },
    });
    expect(paths()).not.toContain("/api/auth/mfa/challenge");
    expect(forgetUser).toHaveBeenCalledTimes(1);
  });

  it("an account already at aal2 goes straight to next", async () => {
    replies["/api/me/mfa"] = [selection];
    replies["/api/auth/mfa/account"] = [account({ currentLevel: "aal2" })];
    mount("/fatture");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fatture"));
    expect(screen.queryByLabelText("Codice di 6 cifre")).toBeNull();
  });

  it("an account with no verified factor is told to enrol from the console, with Esci and no navigation", async () => {
    replies["/api/me/mfa"] = [noTenant];
    replies["/api/auth/mfa/account"] = [
      account({ factors: [{ id: P, slot: "principale", status: "unverified" }] }),
    ];
    mount();
    expect(
      await screen.findByText("Attiva prima la verifica in due passaggi dalla console."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Esci" })).toBeTruthy();
    expect(screen.queryByLabelText("Codice di 6 cifre")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a 403 forbidden from the account route shows its message and Esci", async () => {
    replies["/api/me/mfa"] = [noTenant];
    replies["/api/auth/mfa/account"] = [accountFail(403, "forbidden", "Non hai accesso.")];
    mount();
    expect(await screen.findByText("Non hai accesso.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Esci" })).toBeTruthy();
  });

  it("the account lock and the backup switch work as in the venue path", async () => {
    replies["/api/me/mfa"] = [noTenant];
    replies["/api/auth/mfa/account"] = [
      account({
        factors: [
          { id: R, slot: "riserva", status: "verified" },
          { id: P, slot: "principale", status: "verified" },
        ],
      }),
    ];
    replies["/api/auth/mfa/account"]!.push({
      ok: false,
      status: 429,
      error: { code: "mfa_locked", message: "s", details: { retryAfterSeconds: 720 } },
    });
    mount();
    await field();
    fireEvent.click(screen.getByRole("button", { name: "Usa il dispositivo di riserva" }));
    await enter("111111");
    expect(await screen.findByText("Troppi tentativi. Riprova tra 12 minuti.")).toBeTruthy();
    expect((calls[2]!.body as { factorId: string }).factorId).toBe(R);
    expect((await field()).disabled).toBe(true);
  });

  it.each([
    ["401 unauthorized", 401, "unauthorized"],
    ["403 mfa_required", 403, "mfa_required"],
    ["403 forbidden", 403, "forbidden"],
    ["409 console_selection_required", 409, "console_selection_required"],
    ["500 internal", 500, "internal"],
  ])("%s from /api/me/mfa makes no account call", async (_name, status, code) => {
    replies["/api/me/mfa"] = [accountFail(status, code, "Errore del server.")];
    mount();
    expect(await screen.findByText("Errore del server.")).toBeTruthy();
    expect(paths()).toEqual(["/api/me/mfa"]);
  });
});
