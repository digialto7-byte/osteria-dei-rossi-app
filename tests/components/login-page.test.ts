import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(public)/login/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
let cookie: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(cookie ? { cookie } : {}),
}));

const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));

const DEVICE_COOKIE = `__Host-odr_device=${"A".repeat(43)}`;

describe("the login page", () => {
  it("opens on the staff screen when the device cookie is present, with the owner's form closed", async () => {
    cookie = DEVICE_COOKIE;
    const html = await render();
    cookie = null;
    expect(html).not.toMatch(/<h1[^>]*>Accedi<\/h1>/);
    expect(html).toMatch(/aria-expanded="false"[^>]*>Sei il titolare\? Accedi con email</);
    expect(html).not.toContain("Accedi con la password");
  });

  it("ignores a malformed device cookie", async () => {
    cookie = "__Host-odr_device=x";
    const html = await render();
    cookie = null;
    expect(html).toMatch(/<h1[^>]*>Accedi<\/h1>/);
  });

  it("links a new staff phone to the enrolment page", async () => {
    const html = await render();
    expect(html).toMatch(
      /<a[^>]*href="\/dispositivo"[^>]*>Abilita questo telefono per il personale<\/a>/,
    );
  });

  it("makes that link a 44 px target", async () => {
    const tag = (await render()).match(/<a[^>]*href="\/dispositivo"[^>]*>/)?.[0];
    expect(tag).toContain("min-h-tap");
  });

  it("keeps the sign-in heading and offers the password form with the link as the fallback", async () => {
    const html = await render({ next: "/fatture" });
    expect(html).toMatch(/<h1[^>]*>Accedi<\/h1>/);
    expect(html).toMatch(/<label[^>]*><span[^>]*>Email<\/span><input[^>]*autoComplete="username"/);
    expect(html).toMatch(/<label[^>]*>Password<\/label>/);
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toMatch(/<button[^>]*>Accedi con la password<\/button>/);
    expect(html).toMatch(/<button[^>]*>Inviami il link<\/button>/);
    expect(html).toContain("Password dimenticata o non ancora impostata?");
  });

  it("says the session ended after 30 days when sent back by the cap", async () => {
    expect(await render({ errore: "sessione" })).toContain(
      "La sessione è scaduta dopo 30 giorni: accedi di nuovo.",
    );
    expect(await render()).not.toContain("dopo 30 giorni");
  });

  it("shows the link error for ?errore=link", async () => {
    expect(await render({ errore: "link" })).toContain("Il link non è valido o è scaduto.");
  });

  it("does not carry the next path into the enrolment link", async () => {
    const html = await render({ next: "/fatture" });
    expect(html).not.toMatch(/href="\/dispositivo\?/);
  });
});
