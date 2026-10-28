// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContrastToggle } from "@/app/(owner)/cucina/contrast-toggle";

afterEach(cleanup);

describe("ContrastToggle", () => {
  it("is a button 'Alto contrasto' whose aria-pressed follows the state, 44 px tall", () => {
    const { rerender } = render(
      createElement(ContrastToggle, { high: false, onToggle: () => undefined }),
    );
    const button = screen.getByRole("button", { name: "Alto contrasto" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.className).toContain("min-h-tap");
    rerender(createElement(ContrastToggle, { high: true, onToggle: () => undefined }));
    expect(
      screen.getByRole("button", { name: "Alto contrasto" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("asks for the opposite state when pressed", () => {
    const onToggle = vi.fn();
    render(createElement(ContrastToggle, { high: false, onToggle }));
    fireEvent.click(screen.getByRole("button", { name: "Alto contrasto" }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
