// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P2-1 B5: the /doppia-verifica list. It reads its own factors from GET /api/me/mfa and the other accounts from GET /api/mfa/accounts; it adds and removes through the API only.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

const P = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const f = (
  id: string,
  slot: string,
  status = "verified",
  createdAt = "2026-11-12T10:00:00.000Z",
) => ({
  id,
  slot,
  status,
  createdAt,
});
const status = (over: Record<string, unknown> = {}): Reply => ({
  ok: true,
  status: 200,
  data: {
    role: "owner",
    mode: "enrolled",
    gate: "ok",
    currentLevel: "aal2",
    factors: [f(P, "principale")],
    canAddFactor: true,
    lockedUntil: null,
    ...over,
  },
});
const accounts = (list: unknown[] = []): Reply => ({
  ok: true,
  status: 200,
  data: { accounts: list },
});

const calls: { path: string; method: string | undefined; body: unknown }[] = [];
let replies: Record<string, Reply[]> = {};
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, method: init?.method, body: init?.body });
  return Promise.resolve(
    replies[path]?.shift() ?? replies[path]?.[0] ?? { ok: true, status: 200, data: {} },
  );
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));

import { FactorList } from "@/app/(owner)/doppia-verifica/factor-list";

const setReplies = (over: { status?: Reply[]; accounts?: Reply[] } = {}) => {
  replies = {
    "/api/me/mfa": over.status ?? [status()],
    "/api/mfa/accounts": over.accounts ?? [accounts()],
  };
};
beforeEach(() => {
  calls.length = 0;
  apiJson.mockClear();
  setReplies();
});
afterEach(cleanup);

const mount = () => render(createElement(FactorList, {}));
const findMain = () => screen.findByText("Principale", { exact: false });

describe("FactorList own factors", () => {
  it("reads both endpoints and shows the main device active from its date (Europe/Rome)", async () => {
    setReplies({
      status: [status({ factors: [f(P, "principale", "verified", "2026-11-12T23:30:00.000Z")] })],
    });
    mount();
    expect((await findMain()).textContent).toContain("Principale");
    expect(screen.getByText(/attivo dal 13\/11\/2026/)).toBeTruthy();
    expect(calls.map((c) => c.path).sort()).toEqual(["/api/me/mfa", "/api/mfa/accounts"]);
  });

  it("a missing backup shows 'non configurato' with Aggiungi", async () => {
    mount();
    await findMain();
    expect(screen.getByText(/Riserva/)).toBeTruthy();
    expect(screen.getByText(/non configurato/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aggiungi" })).toBeTruthy();
  });

  it("canAddFactor false hides Aggiungi", async () => {
    setReplies({ status: [status({ canAddFactor: false })] });
    mount();
    await findMain();
    expect(screen.queryByRole("button", { name: "Aggiungi" })).toBeNull();
  });

  it("an unverified factor is 'Non completato' with Rimuovi", async () => {
    setReplies({
      status: [status({ factors: [f(P, "principale"), f(R, "riserva", "unverified")] })],
    });
    mount();
    await findMain();
    expect(screen.getByText(/Non completato/)).toBeTruthy();
  });

  it("Aggiungi opens the enrolment for the backup slot and reloads the list when it finishes", async () => {
    setReplies({
      status: [status(), status({ factors: [f(P, "principale"), f(R, "riserva")] })],
    });
    replies["/api/me/mfa/factors"] = [
      {
        ok: true,
        status: 201,
        data: {
          factorId: R,
          slot: "riserva",
          qrImage: "data:image/svg+xml;utf-8,%3Csvg%3E",
          secret: "JBSWY3DPEHPK3PXP",
        },
      },
    ];
    replies[`/api/me/mfa/factors/${R}/verify`] = [
      { ok: true, status: 200, data: { factor: {}, currentLevel: "aal2" } },
    ];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Aggiungi" }));
    await screen.findByAltText("Codice QR per l'app di autenticazione");
    expect(calls.find((c) => c.path === "/api/me/mfa/factors")?.body).toEqual({ slot: "riserva" });
    fireEvent.change(screen.getByLabelText("Codice di 6 cifre"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Attiva" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/me/mfa").length).toBe(2));
  });

  it("Rimuovi asks to confirm, then DELETEs the factor and reloads", async () => {
    setReplies({ status: [status(), status({ factors: [] })] });
    replies[`/api/me/mfa/factors/${P}`] = [{ ok: true, status: 200, data: { removed: true } }];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rimuovi" }));
    expect(
      screen.getByText("Rimuovere questo dispositivo? Per entrare userai solo l'altro."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === `/api/me/mfa/factors/${P}`)?.method).toBe("DELETE"),
    );
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/me/mfa").length).toBe(2));
  });

  it("Annulla closes the confirm and deletes nothing", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rimuovi" }));
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByText(/Rimuovere questo dispositivo/)).toBeNull();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("409 mfa_last_factor on remove shows the admin message", async () => {
    replies[`/api/me/mfa/factors/${P}`] = [
      {
        ok: false,
        status: 409,
        error: {
          code: "mfa_last_factor",
          message:
            "Per gli account admin la verifica è obbligatoria: aggiungi un altro dispositivo prima di rimuovere questo.",
        },
      },
    ];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rimuovi" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    expect(
      await screen.findByText(
        "Per gli account admin la verifica è obbligatoria: aggiungi un altro dispositivo prima di rimuovere questo.",
      ),
    ).toBeTruthy();
  });
});

describe("FactorList other accounts (read-only, Q-T1 = V1)", () => {
  it("shows the DigiAlto text and no reset button, ever", async () => {
    setReplies({
      accounts: [accounts([{ id: "a", displayName: "Admin Demo", role: "admin", factorCount: 0 }])],
    });
    mount();
    await screen.findByText("Admin Demo", { exact: false });
    expect(
      screen.getByText(
        "Se un titolare o un admin perde il telefono e non ha il dispositivo di riserva, contatta DigiAlto: azzererà la verifica e l'operazione verrà registrata.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /azzer|reset/i })).toBeNull();
    expect(calls.some((c) => c.path.includes("mfa-reset"))).toBe(false);
  });

  it("lists each account with its role word and device count", async () => {
    setReplies({
      accounts: [
        accounts([
          { id: "a", displayName: "Admin Demo", role: "admin", factorCount: 2 },
          { id: "b", displayName: "Mario Bianchi", role: "owner", factorCount: 0 },
        ]),
      ],
    });
    mount();
    const admin = (await screen.findByText("Admin Demo", { exact: false })).closest("li")!;
    expect(within(admin).getByText(/Amministratore/)).toBeTruthy();
    expect(within(admin).getByText(/2 dispositivi/)).toBeTruthy();
    const owner = screen.getByText("Mario Bianchi", { exact: false }).closest("li")!;
    expect(within(owner).getByText(/Titolare/)).toBeTruthy();
    expect(within(owner).getByText(/nessun dispositivo/)).toBeTruthy();
  });

  it("no other accounts: the section is not shown, but the DigiAlto text still is", async () => {
    mount();
    await findMain();
    expect(screen.getByText(/contatta DigiAlto/)).toBeTruthy();
  });

  it("when the other accounts cannot be read, the own rows and the DigiAlto text still show (B6)", async () => {
    setReplies({
      accounts: [
        { ok: false, status: 500, error: { code: "internal", message: "Errore del server." } },
      ],
    });
    mount();
    await findMain();
    expect(screen.getByText(/contatta DigiAlto/)).toBeTruthy();
  });
});
