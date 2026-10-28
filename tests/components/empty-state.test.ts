// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "@/components/empty-state";

afterEach(cleanup);

describe("EmptyState", () => {
  it("shows the message and, when given, exactly one link after it", () => {
    const { container } = render(
      createElement(EmptyState, {
        messageKey: "common.empty",
        action: { labelKey: "empty.import", href: "/anagrafiche/importa" },
      }),
    );
    expect(screen.getByText("Nessun elemento.")).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/anagrafiche/importa");
    expect(links[0]!.textContent).toBe("Importa da file");
    // The link comes after the text, in the same block.
    const text = container.querySelector("p")!;
    expect(text.compareDocumentPosition(links[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is text only without an action", () => {
    render(createElement(EmptyState, { messageKey: "common.empty", action: null }));
    expect(screen.getByText("Nessun elemento.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the link is a 44 px target in the page's link style", () => {
    render(
      createElement(EmptyState, {
        messageKey: "common.empty",
        action: { labelKey: "empty.import", href: "/x" },
      }),
    );
    expect(screen.getByRole("link").className).toContain("min-h-tap");
  });
});
