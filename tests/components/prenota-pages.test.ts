// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = "/prenota/osteria-demo";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
// The pages' children fetch on mount; the title, the band and the page's own markup are what is tested here.
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

// P2i (ADR-045): the guest pages wear the Costì look (the one theme since P2j), and a guest never sees the name or logo "Costì".
describe.each([
  ["the booking page", BookingPage, bookingMetadata, "<p>modulo</p>"],
  ["the cancel page", CancelPage, cancelMetadata, "<p>annullamento</p>"],
])("%s", (_name, Page, metadata, content) => {
  it("renders its content first, with no marker", async () => {
    const html = renderToStaticMarkup(await Page(props));
    expect(html).toBe(content);
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
