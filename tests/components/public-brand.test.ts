// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/login";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { PublicBrand } from "@/app/(public)/public-brand";

afterEach(cleanup);

describe("PublicBrand", () => {
  it.each(["/prenota/osteria-demo", "/prenota/osteria-demo/annulla"])(
    "%s: the wordmark is plain text, no link",
    (path) => {
      pathname = path;
      render(createElement(PublicBrand));
      expect(screen.getByText("Osteria Dei Rossi")).toBeTruthy();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    },
  );

  it.each(["/login", "/pin", "/dispositivo"])("%s: still the link to Home (Q-QW6)", (path) => {
    pathname = path;
    render(createElement(PublicBrand));
    expect(screen.getByRole("link", { name: "Osteria Dei Rossi, Home" }).getAttribute("href")).toBe(
      "/",
    );
  });
});
