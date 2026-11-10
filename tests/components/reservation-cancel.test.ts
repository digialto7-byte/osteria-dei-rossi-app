// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/lib/i18n";
import { SLUG } from "../helpers/reservations-public-data";

// Reservations plan §5 B11: the public cancel page. GET shows the booking; only the click POSTs.
type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

const VIEW = {
  date: "2026-11-27",
  time: "20:00",
  party: 4,
  serviceName: "Cena",
  status: "accepted",
  canCancel: true,
};
let viewReply: Result;
let cancelReply: Result;
const calls: { path: string; init: Init }[] = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  return Promise.resolve(init?.method === "POST" ? cancelReply : viewReply);
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));

const { CancelView } = await import("@/app/(public)/prenota/[slug]/annulla/cancel-view");

const it_ = messages.it;
const en_ = messages.en;
const TOKEN = "c1.8c8fecc4.23000000-0000-4000-8000-000000000001.1794132000.abc";
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const failure = (status: number, code: string): Result => ({
  ok: false,
  status,
  error: { code, message: "testo del server" },
});
const show = (token: string | null = TOKEN, locale: "it" | "en" = "it") =>
  render(createElement(CancelView, { slug: SLUG, token, locale }));
const posts = () => calls.filter((c) => c.init?.method === "POST");

beforeEach(() => {
  calls.length = 0;
  apiJson.mockClear();
  viewReply = ok(VIEW);
  cancelReply = ok({ status: "cancelled", already: false });
});
afterEach(cleanup);

describe("the cancel page", () => {
  it("reads the booking with the token and shows the summary, without cancelling", async () => {
    show();
    await screen.findByText("ven 27 novembre 2026, 20:00");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(
      `/api/public/reservations/${SLUG}/cancel?t=${encodeURIComponent(TOKEN)}`,
    );
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
    expect(posts()).toHaveLength(0);
    expect(screen.getByText("4 persone")).toBeTruthy();
    expect(screen.getByText("Cena")).toBeTruthy();
    expect(screen.getByText(it_["publicReservation.status.accepted"])).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/tavol|table/i);
  });

  it("cancels only on the click, with the token in the body", async () => {
    show();
    const button = await screen.findByRole("button", {
      name: it_["publicReservation.cancel.button"],
    });
    expect(posts()).toHaveLength(0);
    fireEvent.click(button);
    expect(await screen.findByText(it_["publicReservation.cancel.done"])).toBeTruthy();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.path).toBe(`/api/public/reservations/${SLUG}/cancel`);
    expect(posts()[0]?.init?.body).toEqual({ token: TOKEN });
    expect(
      screen.queryByRole("button", { name: it_["publicReservation.cancel.button"] }),
    ).toBeNull();
  });

  it("says 'already cancelled' when the reply says already", async () => {
    cancelReply = ok({ status: "cancelled", already: true });
    show();
    fireEvent.click(
      await screen.findByRole("button", { name: it_["publicReservation.cancel.button"] }),
    );
    expect(await screen.findByText(it_["publicReservation.cancel.already"])).toBeTruthy();
  });

  it("shows no button when the booking cannot be cancelled, and says why", async () => {
    viewReply = ok({ ...VIEW, status: "declined", canCancel: false });
    show();
    expect(await screen.findByText(it_["publicReservation.status.declined"])).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: it_["publicReservation.cancel.button"] }),
    ).toBeNull();
    expect(screen.getByText(it_["publicReservationError.cancel_status"])).toBeTruthy();
  });

  it("an already cancelled booking reads as cancelled, with no button", async () => {
    viewReply = ok({ ...VIEW, status: "cancelled", canCancel: false });
    show();
    expect(await screen.findByText(it_["publicReservation.status.cancelled"])).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: it_["publicReservation.cancel.button"] }),
    ).toBeNull();
  });

  it("shows one 'link not valid' text for a 404 and for no token (and asks nothing without one)", async () => {
    viewReply = failure(404, "link_invalid");
    const first = show();
    expect(await screen.findByText(it_["publicReservation.cancel.invalid"])).toBeTruthy();
    first.unmount();
    calls.length = 0;
    show(null);
    expect(await screen.findByText(it_["publicReservation.cancel.invalid"])).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("shows the closed message for a 409 cancel_closed and keeps the booking visible", async () => {
    cancelReply = failure(409, "cancel_closed");
    show();
    fireEvent.click(
      await screen.findByRole("button", { name: it_["publicReservation.cancel.button"] }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(it_["publicReservationError.cancel_closed"]);
    expect(document.body.textContent).not.toContain("testo del server");
    expect(screen.getByText("Cena")).toBeTruthy();
  });

  it("a second tap while the request runs does not send twice", async () => {
    let release: (value: Result) => void = () => {};
    apiJson.mockImplementationOnce((path, init) => {
      calls.push({ path, init });
      return Promise.resolve(viewReply);
    });
    apiJson.mockImplementationOnce((path, init) => {
      calls.push({ path, init });
      return new Promise<Result>((resolve) => (release = resolve));
    });
    show();
    const button = await screen.findByRole("button", {
      name: it_["publicReservation.cancel.button"],
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(posts()).toHaveLength(1);
    release(ok({ status: "cancelled", already: false }));
    expect(await screen.findByText(it_["publicReservation.cancel.done"])).toBeTruthy();
  });

  it("is in English for locale en", async () => {
    show(TOKEN, "en");
    expect(
      await screen.findByRole("button", { name: en_["publicReservation.cancel.button"] }),
    ).toBeTruthy();
    expect(screen.getByText(en_["publicReservation.status.accepted"])).toBeTruthy();
  });
});
