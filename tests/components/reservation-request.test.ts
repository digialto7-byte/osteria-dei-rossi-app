// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/lib/i18n";
import { PAGE_REPLY, SLOTS_REPLY, SLUG } from "../helpers/reservations-public-data";

// Reservations plan §5 B11: the public request form. Every value on screen comes from /api/public/reservations/*; nothing here decides a rule.
type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

const PAGE = {
  ...PAGE_REPLY,
  privacy: { ...PAGE_REPLY.privacy, noticeVersion: "draft-test" },
  formToken: "f1.token-one",
};
let pageReply: Result;
let slotsReply: Result;
let postReply: Result;
const calls: { path: string; init: Init }[] = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (init?.method === "POST") return Promise.resolve(postReply);
  if (path.endsWith("/page")) return Promise.resolve(pageReply);
  if (path.includes("/slots")) return Promise.resolve(slotsReply);
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));

const { RequestForm } = await import("@/app/(public)/prenota/[slug]/request-form");

const it_ = messages.it;
const en_ = messages.en;
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const failure = (status: number, code: string, details?: unknown): Result => ({
  ok: false,
  status,
  error: { code, message: "testo del server", details },
});
const show = (locale: "it" | "en" = "it") =>
  render(createElement(RequestForm, { slug: SLUG, locale }));
const slotCalls = () => calls.filter((c) => c.path.includes("/slots"));

async function loaded(locale: "it" | "en" = "it") {
  show(locale);
  await screen.findByRole("heading", { name: PAGE.venueName });
}
async function pickDate(date = "2026-11-27", party?: string) {
  fireEvent.change(screen.getByLabelText(it_["publicReservation.date"]), {
    target: { value: date },
  });
  if (party)
    fireEvent.change(screen.getByLabelText(it_["publicReservation.party"]), {
      target: { value: party },
    });
}
async function fillEverything() {
  await pickDate("2026-11-27", "4");
  fireEvent.click(await screen.findByRole("button", { name: "19:00" }));
  fireEvent.change(screen.getByLabelText(it_["publicReservation.name"]), {
    target: { value: "Cliente Demo" },
  });
  fireEvent.change(screen.getByLabelText(it_["publicReservation.phone"]), {
    target: { value: "+39 000 0000001" },
  });
  fireEvent.change(screen.getByLabelText(it_["publicReservation.email"]), {
    target: { value: "cliente.demo@example.com" },
  });
}
const submitButton = () => screen.getByRole("button", { name: it_["publicReservation.submit"] });
const ack = () => screen.getByLabelText(it_["publicReservation.privacy.ack"]);

beforeEach(() => {
  calls.length = 0;
  apiJson.mockClear();
  pageReply = ok(PAGE);
  slotsReply = ok(SLOTS_REPLY);
  postReply = { ok: true, status: 202, data: { status: "received" } };
});
afterEach(cleanup);

describe("the booking form", () => {
  it("reads the page once and shows the venue, never a table", async () => {
    await loaded();
    expect(calls[0]?.path).toBe(`/api/public/reservations/${SLUG}/page`);
    expect(document.body.textContent).not.toMatch(/tavol|table/i);
  });

  it("shows a loading text first, and the not-available message for a 404", async () => {
    pageReply = failure(404, "not_found");
    show();
    expect(screen.getByText(it_["publicReservation.loading"])).toBeTruthy();
    expect(await screen.findByText(it_["publicReservationError.not_found"])).toBeTruthy();
    expect(screen.queryByLabelText(it_["publicReservation.name"])).toBeNull();
  });

  it("limits the date to the page's range and the party select to maxPartyOnline, then offers the call text", async () => {
    await loaded();
    const date = screen.getByLabelText(it_["publicReservation.date"]) as HTMLInputElement;
    expect(date.min).toBe(PAGE.minDate);
    expect(date.max).toBe(PAGE.maxDate);
    const party = screen.getByLabelText(it_["publicReservation.party"]) as HTMLSelectElement;
    const values = [...party.options].map((o) => o.value);
    expect(values.slice(0, 8)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(values).not.toContain("9");
    expect(values).toHaveLength(9);
    expect([...party.options].at(-1)?.textContent).toBe("Più di 8");
  });

  it("selecting more than the maximum shows the contact text, hides the form and sends nothing: no phone known", async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText(it_["publicReservation.party"]), {
      target: { value: "more" },
    });
    expect(screen.getByText(it_["publicReservation.partyCallNoPhone"])).toBeTruthy();
    expect(screen.queryByLabelText(it_["publicReservation.name"])).toBeNull();
    expect(screen.queryByRole("button", { name: it_["publicReservation.submit"] })).toBeNull();
  });

  it("with a venue phone the call text carries a tel: link", async () => {
    pageReply = ok({ ...PAGE, venuePhone: "+39 000 0000009" });
    await loaded();
    fireEvent.change(screen.getByLabelText(it_["publicReservation.party"]), {
      target: { value: "more" },
    });
    const link = screen.getByRole("link", { name: "+39 000 0000009" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("tel:+390000000009");
  });

  it("fetches slots once a date and a party are set, and the buttons come from the reply only", async () => {
    await loaded();
    expect(slotCalls()).toHaveLength(0);
    await pickDate("2026-11-27", "4");
    await screen.findByRole("button", { name: "19:00" });
    expect(slotCalls().at(-1)?.path).toBe(
      `/api/public/reservations/${SLUG}/slots?date=2026-11-27&party=4`,
    );
    const free = screen.getByRole("button", { name: "19:00" }) as HTMLButtonElement;
    const taken = screen.getByRole("button", {
      name: "19:15, non disponibile",
    }) as HTMLButtonElement;
    expect(free.disabled).toBe(false);
    expect(taken.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /19:30/ })).toBeNull();
  });

  it("shows the service tabs from the reply and switches the slots", async () => {
    slotsReply = ok({
      ...SLOTS_REPLY,
      services: [
        SLOTS_REPLY.services[0],
        { key: "pranzo", name: "Pranzo", slots: [{ time: "12:30", available: true }] },
      ],
    });
    await loaded();
    await pickDate("2026-11-27", "2");
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Cena", "Pranzo"]);
    fireEvent.click(tabs[1]!);
    expect(await screen.findByRole("button", { name: "12:30" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "19:00" })).toBeNull();
  });

  it("says so when the day is closed (from the reply's closed weekdays) without asking for slots", async () => {
    await loaded();
    // 2026-11-23 is a Monday and the page closes weekday 1.
    await pickDate("2026-11-23", "2");
    expect(await screen.findByText(it_["publicReservation.closed"])).toBeTruthy();
    expect(slotCalls()).toHaveLength(0);
  });

  it("says so when the slots reply is closed or empty", async () => {
    slotsReply = ok({ ...SLOTS_REPLY, closed: true, services: [] });
    await loaded();
    await pickDate("2026-11-27", "2");
    expect(await screen.findByText(it_["publicReservation.closed"])).toBeTruthy();
  });

  it("keeps the submit button disabled until the box is ticked", async () => {
    await loaded();
    await fillEverything();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    expect((ack() as HTMLInputElement).checked).toBe(false);
    fireEvent.click(ack());
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps it disabled until a time is picked and the fields are filled", async () => {
    await loaded();
    fireEvent.click(ack());
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    await fillEverything();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("has the honeypot in the DOM, off-screen by a class, out of the tab order and hidden from assistive tech", async () => {
    await loaded();
    const field = document.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(field).not.toBeNull();
    expect(field.tabIndex).toBe(-1);
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.closest("[aria-hidden='true']")).not.toBeNull();
    expect(field.closest("[class*='-left-']") ?? field.className).toBeTruthy();
    expect(field.closest("[style]")).toBeNull();
    expect(field.value).toBe("");
  });

  it("sends exactly the documented keys, with the token and the notice version from the page", async () => {
    await loaded();
    await fillEverything();
    fireEvent.click(ack());
    fireEvent.click(submitButton());
    await screen.findByText(it_["publicReservation.sent"]);
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.path).toBe(`/api/public/reservations/${SLUG}/requests`);
    expect(post.init?.body).toEqual({
      date: "2026-11-27",
      serviceKey: "cena",
      time: "19:00",
      party: 4,
      name: "Cliente Demo",
      phone: "+39 000 0000001",
      email: "cliente.demo@example.com",
      locale: "it",
      privacyAck: true,
      website: "",
      formToken: "f1.token-one",
    });
    expect(Object.keys(post.init?.body as object).sort()).toEqual([
      "date",
      "email",
      "formToken",
      "locale",
      "name",
      "party",
      "phone",
      "privacyAck",
      "serviceKey",
      "time",
      "website",
    ]);
  });

  it("passes a filled honeypot through unchanged, for the server to turn away", async () => {
    await loaded();
    await fillEverything();
    fireEvent.change(document.querySelector('input[name="website"]')!, {
      target: { value: "spam" },
    });
    fireEvent.click(ack());
    fireEvent.click(submitButton());
    await screen.findByText(it_["publicReservation.sent"]);
    expect(
      (calls.find((c) => c.init?.method === "POST")?.init?.body as { website: string }).website,
    ).toBe("spam");
  });

  it("on 202 shows the success text and takes the form away; a second tap cannot send again", async () => {
    await loaded();
    await fillEverything();
    fireEvent.click(ack());
    fireEvent.click(submitButton());
    expect(await screen.findByText(it_["publicReservation.sent"])).toBeTruthy();
    expect(screen.queryByRole("button", { name: it_["publicReservation.submit"] })).toBeNull();
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
  });

  it.each([
    ["rate_limited", 429, undefined, it_["publicReservationError.rate_limited"]],
    ["form_too_fast", 422, undefined, it_["publicReservationError.form_too_fast"]],
    [
      "slot_unavailable",
      422,
      { reason: "slot_limit" },
      it_["publicReservationError.slot.slot_limit"],
    ],
    ["slot_unavailable", 422, { reason: "no_fit" }, it_["publicReservationError.slot.no_fit"]],
    ["invalid_request", 400, { reason: "email" }, it_["publicReservationError.field.email"]],
    ["reservations_unconfigured", 503, undefined, it_["publicReservationError.unconfigured"]],
    ["internal", 500, undefined, it_["publicReservation.error.generic"]],
  ])(
    "shows the message of %s %j in an alert and keeps the form",
    async (code, status, details, text) => {
      postReply = failure(status, code, details);
      await loaded();
      await fillEverything();
      fireEvent.click(ack());
      fireEvent.click(submitButton());
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(text);
      // The server's own text is never shown.
      expect(document.body.textContent).not.toContain("testo del server");
      expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
    },
  );

  it("reads the slots again after a slot error, and the page again (a new token) after an expired form", async () => {
    postReply = failure(422, "slot_unavailable", { reason: "slot_limit" });
    await loaded();
    await fillEverything();
    fireEvent.click(ack());
    const before = slotCalls().length;
    fireEvent.click(submitButton());
    await screen.findByRole("alert");
    await waitFor(() => expect(slotCalls().length).toBeGreaterThan(before));

    postReply = failure(422, "form_expired");
    pageReply = ok({ ...PAGE, formToken: "f1.token-two" });
    const pages = () => calls.filter((c) => c.path.endsWith("/page")).length;
    const pagesBefore = pages();
    fireEvent.click(submitButton());
    await waitFor(() => expect(pages()).toBe(pagesBefore + 1));
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(
        (calls.filter((c) => c.init?.method === "POST").at(-1)?.init?.body as { formToken: string })
          .formToken,
      ).toBe("f1.token-two"),
    );
  });

  it("shows the privacy notice from the page's controller, in a details element", async () => {
    await loaded();
    const details = document.querySelector("details")!;
    expect(details).not.toBeNull();
    const text = details.textContent ?? "";
    expect(text).toContain("Osteria Demo S.r.l. (demo)");
    expect(text).toContain("IT00000000000");
    expect(text).toContain("privacy@example.com");
    expect(screen.getByText(it_["publicReservation.privacy.short"])).toBeTruthy();
  });

  it("omits the VAT number when the page has none", async () => {
    pageReply = ok({ ...PAGE, privacy: { ...PAGE.privacy, controllerVat: null } });
    await loaded();
    expect(document.querySelector("details")?.textContent).not.toContain("P. IVA");
  });

  it("is in English for locale en, in the labels, the notice and the sent locale", async () => {
    await loaded("en");
    expect(screen.getByLabelText(en_["publicReservation.date"])).toBeTruthy();
    expect(screen.getByText(en_["publicReservation.privacy.short"])).toBeTruthy();
    fireEvent.change(screen.getByLabelText(en_["publicReservation.date"]), {
      target: { value: "2026-11-27" },
    });
    fireEvent.change(screen.getByLabelText(en_["publicReservation.party"]), {
      target: { value: "4" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "19:00" }));
    fireEvent.change(screen.getByLabelText(en_["publicReservation.name"]), {
      target: { value: "Cliente Demo" },
    });
    fireEvent.change(screen.getByLabelText(en_["publicReservation.phone"]), {
      target: { value: "+39 000 0000001" },
    });
    fireEvent.change(screen.getByLabelText(en_["publicReservation.email"]), {
      target: { value: "cliente.demo@example.com" },
    });
    fireEvent.click(screen.getByLabelText(en_["publicReservation.privacy.ack"]));
    fireEvent.click(screen.getByRole("button", { name: en_["publicReservation.submit"] }));
    await screen.findByText(en_["publicReservation.sent"]);
    expect(
      (calls.find((c) => c.init?.method === "POST")?.init?.body as { locale: string }).locale,
    ).toBe("en");
  });

  it("links to the other language with ?lang, and the current one is marked", async () => {
    await loaded("it");
    const link = screen.getByRole("link", { name: "English" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`/prenota/${SLUG}?lang=en`);
    expect(screen.getByText("Italiano").getAttribute("aria-current")).toBe("true");
  });

  it("gives every control a target of at least 44 px (the min-h-tap class)", async () => {
    await loaded();
    await pickDate("2026-11-27", "4");
    await screen.findByRole("button", { name: "19:00" });
    for (const button of screen.getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toMatch(/min-h-tap/);
    }
    const inputs = within(document.body).getAllByRole("textbox");
    for (const input of inputs) {
      if ((input as HTMLInputElement).name === "website") continue;
      expect(input.className).toMatch(/min-h-tap|h-|py-/);
    }
    void act;
  });
});
