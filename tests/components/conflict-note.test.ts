// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConflictNote } from "@/app/(owner)/tavoli/comanda/conflict-note";
import { LINE_SOUP, LINE_STEW } from "../helpers/orders-data";

afterEach(cleanup);

describe("ConflictNote", () => {
  it("is an alert with the server's message and the line as it is now", () => {
    render(
      createElement(ConflictNote, {
        message:
          "Questa riga è stata cambiata da Cameriere Due Demo alle 20:31: ecco la versione attuale.",
        line: LINE_STEW,
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("cambiata da Cameriere Due Demo alle 20:31");
    expect(alert.textContent).toContain("Ora: 2 × Spezzatino con polenta (demo)");
  });

  it("adds the note and says half portions as ½", () => {
    render(createElement(ConflictNote, { message: "x", line: LINE_SOUP }));
    expect(screen.getByRole("alert").textContent).toContain(
      "Ora: ½ Zuppa del giorno (demo) · senza cipolla",
    );
  });

  it("without a line it is the message alone", () => {
    render(createElement(ConflictNote, { message: "Il tavolo è stato chiuso.", line: null }));
    expect(screen.getByRole("alert").textContent).toBe("Il tavolo è stato chiuso.");
  });
});
