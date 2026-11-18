// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = "/prenota/osteria-demo";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
// The pages' children fetch on mount; the marker, the title and the band are what is tested here.
vi.mock("@/app/(public)/prenota/[slug]/request-form", () => ({
  RequestForm: () => createElement("p", null, "modulo"),
}));
vi.mock("@/app/(public)/prenota/[slug]/annulla/cancel-view", () => ({
  CancelView: () => createElement("p", null, "annullamento"),
}));

import PublicLayout from "@/app/(public)/layout";
import CancelPage, { metadata as cancelMetadata } from "@/app/(public)/prenota/[slug]/annulla/page";
import BookingPage, { metadata as bookingMetadata } from "@/app/(public)/prenota/[slug]/page";
import { VENUE_LAYER_DEFAULT } from "@/lib/design/venue-layer";

afterEach(cleanup);

const props = {
  params: Promise.resolve({ slug: "osteria-demo" }),
  searchParams: Promise.resolve({ t: "token" }),
};

// P2i (ADR-045): the guest pages wear the Costì look, and a guest never sees the name or logo "Costì".
describe.each([
  ["the booking page", BookingPage, bookingMetadata],
  ["the cancel page", CancelPage, cancelMetadata],
])("%s", (_name, Page, metadata) => {
  it("renders the Costì marker once, before its content", async () => {
    const html = renderToStaticMarkup(await Page(props));
    expect(html.startsWith('<span data-brand="costi" hidden=""></span>')).toBe(true);
    expect(html.match(/data-brand="costi"/g)).toHaveLength(1);
  });

  it("keeps the venue's name as the tab title", () => {
    expect(metadata.title).toBe(VENUE_LAYER_DEFAULT.name);
  });

  it("shows no Costì name or logo, and the band has the venue's name and no link", async () => {
    render(createElement(PublicLayout, null, await Page(props)));
    expect(document.body.textContent).not.toMatch(/costì/i);
    expect(document.querySelector('img[alt="Costì"]')).toBeNull();
    const band = screen.getByRole("banner");
    expect(band.textContent).toContain(VENUE_LAYER_DEFAULT.name);
    expect(band.querySelector("a")).toBeNull();
  });
});
