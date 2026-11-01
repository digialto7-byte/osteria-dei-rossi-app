// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORECAST_CHEF, FORECAST_OWNER } from "../helpers/push-data";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });

let replies: Record<string, Result>;
const calls: string[] = [];
const apiJson = vi.fn((path: string): Promise<Result> => {
  calls.push(path);
  return Promise.resolve(
    replies[path] ?? { ok: false, status: 404, error: { code: "not_found", message: "x" } },
  );
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string) => apiJson(path),
}));

// M24 step 11: the CSV links read the role from useMe; a mock keeps /api/me out of the calls these tests count.
let meRole: string | null = "owner";
vi.mock("@/components/use-me", () => ({
  useMe: () => ({
    status: meRole === null ? "loading" : "ok",
    me:
      meRole === null
        ? null
        : {
            user: { id: "u", displayName: "Titolare Demo", role: meRole },
            tenant: { id: "t", name: "Osteria Demo A" },
          },
    retry: () => undefined,
  }),
}));

import { ForecastPanel } from "@/app/(owner)/produzione/forecast-panel";

const TOMORROW = {
  ...FORECAST_OWNER,
  date: "2026-11-06",
  weekday: 5,
  batches: [{ ...FORECAST_OWNER.batches[0]!, expectedPortions: 18, onHandPortions: 20, gap: -2 }],
};

beforeEach(() => {
  meRole = "owner";
  replies = {
    "/api/reports/forecast": ok(FORECAST_OWNER),
    "/api/reports/forecast?date=2026-11-06": ok(TOMORROW),
  };
  calls.length = 0;
  apiJson.mockClear();
  window.history.replaceState(null, "", "/produzione");
});
afterEach(cleanup);

const plain = (text: string | null) => (text ?? "").replace(/ /g, " ").replace(/\s+/g, " ");
const open = async () => {
  const view = render(createElement(ForecastPanel));
  await screen.findByText(/^Previsione per/);
  return view;
};

describe("the forecast panel (AT5: the sentence)", () => {
  it("reads today's forecast once and shows the heading, the sentence and the shortfall", async () => {
    await open();
    expect(calls).toEqual(["/api/reports/forecast"]);
    expect(
      screen.getByText("Previsione per giovedì 5 novembre · media delle ultime 4 settimane"),
    ).toBeTruthy();
    expect(
      screen.getByText("Di solito il giovedì escono 22 porzioni di Spezzatino; ne hai 14"),
    ).toBeTruthy();
    expect(screen.getByText("ne mancano 8")).toBeTruthy();
  });

  it("says 'di 3 settimane' when a week was closed", async () => {
    replies["/api/reports/forecast"] = ok({ ...FORECAST_OWNER, weeksUsed: 3 });
    await open();
    expect(
      screen.getByText("Previsione per giovedì 5 novembre · media di 3 settimane"),
    ).toBeTruthy();
  });

  it("no shortfall badge when there is enough", async () => {
    replies["/api/reports/forecast"] = ok({
      ...FORECAST_OWNER,
      batches: [{ ...FORECAST_OWNER.batches[0]!, onHandPortions: 30, gap: -8 }],
    });
    await open();
    expect(screen.queryByText(/ne manca/)).toBeNull();
  });

  it("the owner sees the expected covers; the chef does not", async () => {
    await open();
    expect(screen.getByText("Coperti attesi: 31")).toBeTruthy();
    cleanup();
    replies["/api/reports/forecast"] = ok(FORECAST_CHEF);
    await open();
    expect(screen.queryByText(/Coperti attesi/)).toBeNull();
  });

  it("the plates are in a collapsible list that starts closed", async () => {
    const { container } = await open();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByText("Piatti")).toBeTruthy();
    expect(plain(details.textContent)).toContain("Spezzatino con polenta · 22");
  });

  it("no history gives the empty text once and no line", async () => {
    replies["/api/reports/forecast"] = ok({
      ...FORECAST_OWNER,
      weeksUsed: 0,
      covers: { expected: null },
      batches: [{ ...FORECAST_OWNER.batches[0]!, expectedPortions: null, gap: null }],
      plates: [],
    });
    await open();
    expect(screen.getAllByText("Non ci sono ancora vendite di questo giorno.")).toHaveLength(1);
    expect(screen.queryByText(/Di solito/)).toBeNull();
    expect(screen.queryByText(/Coperti attesi/)).toBeNull();
  });
});

describe("Oggi and Domani", () => {
  it("'Domani' requests the date the reply gave as tomorrow, with no date arithmetic", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Domani" }));
    await screen.findByText("Previsione per venerdì 6 novembre · media delle ultime 4 settimane");
    expect(calls).toEqual(["/api/reports/forecast", "/api/reports/forecast?date=2026-11-06"]);
    expect(
      screen.getByText("Di solito il venerdì escono 18 porzioni di Spezzatino; ne hai 20"),
    ).toBeTruthy();
  });

  it("marks the chosen chip with aria-pressed and keeps it in the address", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Oggi" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Domani" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Domani" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(window.location.search).toBe("?previsione=domani");
    fireEvent.click(screen.getByRole("button", { name: "Oggi" }));
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("an address with ?previsione=domani opens on tomorrow", async () => {
    window.history.replaceState(null, "", "/produzione?previsione=domani");
    render(createElement(ForecastPanel));
    await screen.findByText(/^Previsione per venerdì 6 novembre/);
    expect(calls).toEqual(["/api/reports/forecast", "/api/reports/forecast?date=2026-11-06"]);
  });

  it("the chips are 44 px tap targets", async () => {
    await open();
    for (const name of ["Oggi", "Domani"]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-tap");
    }
  });
});

describe("failures", () => {
  it("a failed read shows a quiet message, not an alert", async () => {
    replies["/api/reports/forecast"] = {
      ok: false,
      status: 500,
      error: {
        code: "report_unavailable",
        message: "I dati non sono disponibili. Riprova tra poco.",
      },
    };
    render(createElement(ForecastPanel));
    expect(await screen.findByText("I dati non sono disponibili. Riprova tra poco.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed 'Domani' keeps the chips and shows the error under them, so the user can go back to 'Oggi'", async () => {
    replies["/api/reports/forecast?date=2026-11-06"] = {
      ok: false,
      status: 500,
      error: { code: "report_unavailable", message: "I dati non sono disponibili." },
    };
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Domani" }));
    expect(await screen.findByText("I dati non sono disponibili.")).toBeTruthy();
    expect(screen.queryByText(/Di solito/)).toBeNull();
    expect(screen.getByRole("button", { name: "Domani" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Oggi" }));
    await screen.findByText(/Di solito il giovedì/);
    expect(screen.queryByText("I dati non sono disponibili.")).toBeNull();
  });

  it("a 403 renders nothing", async () => {
    replies["/api/reports/forecast"] = {
      ok: false,
      status: 403,
      error: { code: "forbidden", message: "x" },
    };
    const { container } = render(createElement(ForecastPanel));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container.textContent).toBe("");
  });
});

describe("M24: the CSV links", () => {
  it("two links with ?date= the reply's date", async () => {
    await open();
    expect(
      screen.getByRole("link", { name: "Scarica CSV preparazioni" }).getAttribute("href"),
    ).toBe("/api/exports/forecast.csv?date=2026-11-05");
    expect(screen.getByRole("link", { name: "Scarica CSV piatti" }).getAttribute("href")).toBe(
      "/api/exports/forecast-plates.csv?date=2026-11-05",
    );
  });

  it("after choosing Domani the links follow the reply's date", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Domani" }));
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Scarica CSV preparazioni" }).getAttribute("href"),
      ).toBe("/api/exports/forecast.csv?date=2026-11-06"),
    );
    expect(screen.getByRole("link", { name: "Scarica CSV piatti" }).getAttribute("href")).toBe(
      "/api/exports/forecast-plates.csv?date=2026-11-06",
    );
  });

  it.each(["chef", "waiter"])("%s has no links", async (role) => {
    meRole = role;
    replies["/api/reports/forecast"] = ok(FORECAST_CHEF);
    await open();
    expect(screen.queryByRole("link", { name: /Scarica CSV/ })).toBeNull();
  });
});
