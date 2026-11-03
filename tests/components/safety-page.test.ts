// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";

// M25b step 5 (plan §3.5, Q216): /sicurezza is an empty "in arrivo" page, the future entry of the HACCP register. It promises no
// sensor, temperature or date, shows nothing but its text, and reads /api/me only.
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

import SafetyPage from "@/app/(owner)/sicurezza/page";
import { resetMe } from "@/components/use-me";

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
});
afterEach(cleanup);

describe("SafetyPage", () => {
  it.each(["owner", "admin"])("shows the %s the title and the coming-soon line only", async (r) => {
    role = r;
    const { container } = render(createElement(SafetyPage));
    await screen.findByText("In arrivo: qui troverai il registro di sicurezza alimentare (HACCP).");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sicurezza");
    expect(container.querySelectorAll("a, button, form, input, select, textarea")).toHaveLength(0);
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
    expect(apiJson.mock.calls.map((c) => c[0])).toEqual(["/api/me"]);
  });

  it.each(["chef", "waiter"])("tells the %s the section is reserved", async (r) => {
    role = r;
    render(createElement(SafetyPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Questa sezione è riservata al titolare e all'amministratore.");
    expect(screen.queryByText(/In arrivo/)).toBeNull();
  });

  it("promises no sensor, thermometer or temperature, in either language", () => {
    for (const locale of ["it", "en"] as const) {
      const text = [
        t("safety.title", {}, locale),
        t("safety.soon", {}, locale),
        t("safety.forbidden", {}, locale),
      ]
        .join(" ")
        .toLowerCase();
      expect(text).not.toMatch(/sensor|termometr|thermometer|temperatur/);
    }
  });
});
