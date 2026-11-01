// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let role: string | null = "owner";
vi.mock("@/components/use-me", () => ({
  useMe: () => ({
    status: role === null ? "loading" : "ok",
    me:
      role === null
        ? null
        : {
            user: { id: "u", displayName: "Titolare Demo", role },
            tenant: { id: "t", name: "Osteria Demo A" },
          },
    retry: () => undefined,
  }),
}));

import { CsvLink } from "@/components/csv-link";

beforeEach(() => {
  role = "owner";
});
afterEach(cleanup);

describe("CsvLink", () => {
  it.each(["owner", "admin"])("%s: one download link 'Scarica CSV' of at least 44 px", (r) => {
    role = r;
    render(createElement(CsvLink, { href: "/api/exports/kpis.csv?period=day" }));
    const link = screen.getByRole("link", { name: "Scarica CSV" });
    expect(link.getAttribute("href")).toBe("/api/exports/kpis.csv?period=day");
    expect(link.hasAttribute("download")).toBe(true);
    expect(link.className).toMatch(/min-h-tap/);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it.each(["chef", "waiter"])("%s: nothing is rendered", (r) => {
    role = r;
    const { container } = render(createElement(CsvLink, { href: "/api/exports/kpis.csv" }));
    expect(container.innerHTML).toBe("");
  });

  it("while the role is unknown nothing is rendered", () => {
    role = null;
    const { container } = render(createElement(CsvLink, { href: "/api/exports/kpis.csv" }));
    expect(container.innerHTML).toBe("");
  });

  it("takes a label for the screens with two files", () => {
    render(
      createElement(CsvLink, { href: "/api/exports/forecast.csv", label: "Scarica CSV piatti" }),
    );
    expect(screen.getByRole("link", { name: "Scarica CSV piatti" })).toBeTruthy();
  });

  it("is a plain link: the file name is the server's (no download attribute value)", () => {
    render(createElement(CsvLink, { href: "/api/exports/avt.csv" }));
    expect(screen.getByRole("link").getAttribute("download")).toBe("");
  });
});
