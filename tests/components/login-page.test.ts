import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LoginPage from "@/app/(public)/login/page";

const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));

describe("the login page", () => {
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

  it("keeps the email form and the sign-in heading", async () => {
    const html = await render({ next: "/fatture" });
    expect(html).toContain("Accedi");
    expect(html).toContain("Inviami il link");
  });

  it("does not carry the next path into the enrolment link", async () => {
    const html = await render({ next: "/fatture" });
    expect(html).not.toMatch(/href="\/dispositivo\?/);
  });
});
