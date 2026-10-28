// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StaleBanner } from "@/app/(owner)/cucina/stale-banner";

afterEach(cleanup);

describe("StaleBanner", () => {
  it("is an alert with the words of the plan when the data is stale", () => {
    render(createElement(StaleBanner, { stale: true }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Dati non aggiornati da più di un minuto. Controlla la connessione.",
    );
  });

  it("is nothing when the data is fresh", () => {
    const { container } = render(createElement(StaleBanner, { stale: false }));
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
