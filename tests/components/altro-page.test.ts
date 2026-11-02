// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overflowGroups } from "@/lib/nav/nav-model";

// M25b step 3 (plan §3.1.5): /altro is a plain page of big links for the groups that do not fit in the phone's bar. It reads /api/me
// and the pure nav model only: no other request.
let role = "owner";
const apiJson = vi.fn((path: string) => {
  if (path === "/api/me") {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
        tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo", isDemo: false },
      },
    });
  }
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import AltroPage from "@/app/(owner)/altro/page";
import { resetMe } from "@/components/use-me";

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
});
afterEach(cleanup);

const hrefs = (root: HTMLElement) =>
  [...root.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const flatOverflow = (r: string) =>
  overflowGroups(r as "owner").flatMap((g) => g.sections.map((s) => s.href));

describe("AltroPage", () => {
  it.each(["owner", "admin"])("shows the %s Anagrafica and Registro, in that order", async (r) => {
    role = r;
    const { container } = render(createElement(AltroPage));
    await screen.findByRole("heading", { level: 2, name: "Anagrafica" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Altro");
    expect([...container.querySelectorAll("section h2")].map((h) => h.textContent)).toEqual([
      "Anagrafica",
      "Registro",
    ]);
    expect(container.querySelectorAll("section")).toHaveLength(2);
    expect(hrefs(container)).toEqual(flatOverflow(r));
    expect(hrefs(container)).toHaveLength(11);
  });

  it("keeps the links of one group inside its section", async () => {
    role = "owner";
    const { container } = render(createElement(AltroPage));
    await screen.findByRole("heading", { level: 2, name: "Registro" });
    const registro = container.querySelectorAll("section")[1]!;
    expect(
      within(registro as HTMLElement)
        .getAllByRole("link")
        .map((a) => a.textContent?.replace("›", "").trim()),
    ).toEqual(["Sicurezza", "Costi", "Chiusura", "Report", "Attività"]);
  });

  it("gives every link a 44 px target and no euro sign", async () => {
    role = "owner";
    const { container } = render(createElement(AltroPage));
    await screen.findByRole("heading", { level: 2, name: "Registro" });
    for (const a of container.querySelectorAll("a")) expect(a.className).toContain("min-h-tap");
    expect(container.textContent).not.toContain("€");
  });

  it("tells the chef that every section is in the bar", async () => {
    role = "chef";
    const { container } = render(createElement(AltroPage));
    await screen.findByText("Tutte le sezioni sono nella barra in basso.");
    expect(container.querySelectorAll("h2")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("shows no link while the role is loading", () => {
    role = "owner";
    const { container } = render(createElement(AltroPage));
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("reads /api/me and nothing else", async () => {
    role = "owner";
    render(createElement(AltroPage));
    await waitFor(() => expect(apiJson).toHaveBeenCalled());
    await screen.findByRole("heading", { level: 2, name: "Anagrafica" });
    expect(apiJson.mock.calls.map((c) => c[0])).toEqual(["/api/me"]);
  });
});
