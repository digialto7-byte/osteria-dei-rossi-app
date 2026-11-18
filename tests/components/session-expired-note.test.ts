// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: () => Promise.resolve({ ok: true, status: 200, data: {} }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { LoginScreen } from "@/app/(public)/login/login-screen";
import { ConsoleSignIn } from "@/components/console/console-sign-in";

const TEXT = "La sessione è scaduta dopo 30 giorni: accedi di nuovo.";
afterEach(cleanup);

const screens = {
  "the login screen": (notice: "session" | null) =>
    createElement(LoginScreen, { next: undefined, notice, hasDevice: false, justEnabled: false }),
  "the console sign-in": (notice: "session" | null) => createElement(ConsoleSignIn, { notice }),
};

describe.each(Object.entries(screens))("the session-expired notice on %s", (_name, make) => {
  it("is a role=status region that holds the text once hydrated", () => {
    render(make("session"));
    const note = screen.getByRole("status");
    expect(note.textContent).toBe(TEXT);
    expect(note.className).toContain("text-ink-muted");
  });

  // A live region that already holds its text when the page arrives is often not announced: the server
  // render carries the empty region and the text goes in after hydration.
  it("is in the server render as an empty region", () => {
    const html = renderToStaticMarkup(make("session"));
    expect(html).toMatch(/<p[^>]*role="status"[^>]*><\/p>/);
    expect(html).not.toContain(TEXT);
  });

  it("is absent without the session notice", () => {
    render(make(null));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
