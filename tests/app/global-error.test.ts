// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "@/app/global-error";

// Next.js 16 pre-renders /_global-error as its fallback for a server error. Its scripts carry no nonce, so the nonce
// policy blocks them (it fails closed): the page must be useful with no JavaScript at all (lead decision, step 4).
const error = new Error("boom");
const markup = renderToStaticMarkup(createElement(GlobalError, { error, reset: () => {} }));
const doc = new DOMParser().parseFromString(markup, "text/html");

describe("global-error", () => {
  it("renders its own <html lang=it> and <body>, as Next.js requires", () => {
    expect(markup.startsWith('<html lang="it"')).toBe(true);
    expect(doc.body).not.toBeNull();
  });

  it("says in Italian that something went wrong", () => {
    expect(doc.querySelector("h1")?.textContent).toBe("Qualcosa è andato storto");
    expect(doc.body.textContent).toContain("Si è verificato un errore sul server.");
  });

  it("has a plain link home that needs no script", () => {
    const links = Array.from(doc.querySelectorAll("a"));
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe("Torna all'inizio");
    expect(links[0]?.getAttribute("href")).toBe("/");
  });

  it("hints in text at reloading the page", () => {
    expect(doc.body.textContent).toContain("Se il problema resta, ricarica la pagina.");
  });

  it("carries no script of its own and does not show the error's message", () => {
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("boom");
  });

  it("may keep a retry button in addition to the link, never as the only way out", () => {
    const buttons = doc.querySelectorAll("button");
    expect(buttons.length).toBeLessThanOrEqual(1);
    expect(doc.querySelectorAll("a[href='/']")).toHaveLength(1);
  });
});
