// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HeldOpsBanner } from "@/components/sync/held-ops-banner";
import { DEMO, DUE } from "../helpers/sync-data";

afterEach(cleanup);

describe("HeldOpsBanner (AT8, UI)", () => {
  it("names the person and says to sign in as them on this phone", () => {
    render(createElement(HeldOpsBanner, { held: [{ user: DEMO, count: 3 }] }));
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toBe(
      "Ci sono 3 operazioni di Cameriere Demo non ancora inviate. Accedi come Cameriere Demo su questo telefono per inviarle.",
    );
  });

  it("one operation reads in the singular", () => {
    render(createElement(HeldOpsBanner, { held: [{ user: DUE, count: 1 }] }));
    expect(screen.getByRole("alert").textContent).toBe(
      "C'è 1 operazione di Cameriere Due Demo non ancora inviata. Accedi come Cameriere Due Demo su questo telefono per inviarla.",
    );
  });

  it("one line per person, found by user id", () => {
    const { container } = render(
      createElement(HeldOpsBanner, {
        held: [
          { user: DEMO, count: 3 },
          { user: DUE, count: 2 },
        ],
      }),
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector(`[data-user-id="${DUE.id}"]`)!.textContent).toContain(
      "2 operazioni di Cameriere Due Demo",
    );
  });

  it("nothing held, nothing shown", () => {
    const { container } = render(createElement(HeldOpsBanner, { held: [] }));
    expect(container.innerHTML).toBe("");
  });

  it("a name with markup stays text", () => {
    const { container } = render(
      createElement(HeldOpsBanner, {
        held: [{ user: { id: "x", displayName: "<b>Mario</b>" }, count: 2 }],
      }),
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>Mario</b>");
  });
});
