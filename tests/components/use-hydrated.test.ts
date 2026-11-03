// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useHydrated } from "@/components/use-hydrated";

function Probe() {
  return createElement("output", null, String(useHydrated()));
}

afterEach(cleanup);

describe("useHydrated", () => {
  it("is false in the server render, so the HTML a phone gets first has its buttons disabled", () => {
    expect(renderToString(createElement(Probe))).toContain(">false<");
  });

  it("is true once the component runs in the browser", () => {
    render(createElement(Probe));
    expect(screen.getByRole("status", { hidden: true, name: "" }).textContent).toBe("true");
  });

  it("flips from false to true when server HTML is hydrated", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(Probe));
    document.body.append(container);
    expect(container.textContent).toBe("false");
    await act(async () => {
      hydrateRoot(container, createElement(Probe));
    });
    expect(container.textContent).toBe("true");
    container.remove();
  });
});
