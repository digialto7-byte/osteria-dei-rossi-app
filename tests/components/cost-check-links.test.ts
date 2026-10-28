// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

// Waiters never see costs: the cost check page gives a role that may not read costs no link into them.
let role = "owner";
const apiJson = vi.fn((path: string) =>
  Promise.resolve(
    path === "/api/me"
      ? {
          ok: true as const,
          status: 200,
          data: {
            user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
            tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
          },
        }
      : { ok: false as const, status: 404, error: { code: "not_found", message: "x" } },
  ),
);
vi.mock("@/lib/api/client", async (original) => ({
  ...(await original<typeof import("@/lib/api/client")>()),
  apiJson: (path: string) => apiJson(path),
}));

import CostCheckPage from "@/app/(owner)/costi/verifica/page";

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
});
afterEach(cleanup);

async function open(who: string) {
  role = who;
  const view = render(createElement(CostCheckPage));
  await act(async () => {
    await vi.waitFor(() => expect(apiJson).toHaveBeenCalledWith("/api/me"));
  });
  return view;
}

describe("the cost check page", () => {
  it.each(["owner", "admin"])("gives the %s the way back to the costs", async (who) => {
    const { container } = await open(who);
    await waitFor(() => expect(container.querySelector('a[href="/costi"]')).not.toBeNull());
    expect(screen.getByRole("link", { name: /Torna ai costi/ })).toBeTruthy();
  });

  it.each(["waiter", "chef"])(
    "gives the %s no link to /costi, before or after the role is known",
    async (who) => {
      const { container } = await open(who);
      expect(container.querySelector('a[href^="/costi"]')).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(container.querySelector('a[href^="/costi"]')).toBeNull();
    },
  );

  it("gives no link while the role is still unknown", () => {
    role = "owner";
    const { container } = render(createElement(CostCheckPage));
    expect(container.querySelector('a[href^="/costi"]')).toBeNull();
  });
});
