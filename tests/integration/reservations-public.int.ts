import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/time/venue-date";
import type { TablesList } from "@/server/tables/output";
import { cancelLinkFrom, drainMailJob, waitForMail } from "./helpers/reservation-mail";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// Reservations (PR2, plan B12) against the real local stack: the public request path from the page to the e-mail and back. The routes are called in-process (as the
// M14 to M25c suites do), so the anon client really reaches PostgREST with the publishable key and the gate it signs is really checked by Postgres against the Vault
// value seeded by supabase/seed.sql. The mail cron is run with the CI CRON_SECRET at once instead of waiting for pg_cron; Mailpit (E2E_MAILPIT_URL) holds what was sent.
// Only `createSupabaseServerClient` is replaced (it reads cookies, which exist only inside Next.js): the staff calls carry the signed-in test user's client; the public
// routes never use it. Fake data only: "Cliente Demo", example.com, documentation IPs. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

// The reservation and mail settings: from the job env in CI (fakes there), else the local fakes of .env.example, which equal the seed's Vault value.
const SETTINGS = {
  RESERVATION_GATE_KEY: "replace-me-local-reservation-gate-key-0000",
  RESERVATION_LINK_KEY: "replace-me-local-reservation-link-key-0000",
  CRON_SECRET: "test-cron-secret-not-a-secret-0123456789abcdef",
  MAIL_TRANSPORT: "mailpit",
  MAIL_FROM: "prenotazioni@example.com",
  APP_PUBLIC_ORIGIN: "http://localhost:3000",
} as const;
for (const [name, fallback] of Object.entries(SETTINGS)) {
  vi.stubEnv(name, process.env[name] ?? fallback);
}
const mailpitUrl = process.env.MAILPIT_URL ?? process.env.E2E_MAILPIT_URL ?? "";
vi.stubEnv("MAILPIT_URL", mailpitUrl);

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  // Public routes make no use of it; a staff call gets its own user's client.
  return { createSupabaseServerClient: async () => asUser.store!.getStore() ?? {} };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const settingsRoute = await import("@/app/api/settings/reservations/route");
const tablesRoute = await import("@/app/api/tables/route");
const dayRoute = await import("@/app/api/reservations/route");
const acceptRoute = await import("@/app/api/reservations/[id]/accept/route");
const pageRoute = await import("@/app/api/public/reservations/[slug]/page/route");
const slotsRoute = await import("@/app/api/public/reservations/[slug]/slots/route");
const requestsRoute = await import("@/app/api/public/reservations/[slug]/requests/route");
const cancelRoute = await import("@/app/api/public/reservations/[slug]/cancel/route");
const cronRoute = await import("@/app/api/cron/reservation-mail/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;
interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}
const ORIGIN = "http://localhost:3000";
const FORM_MIN_WAIT_MS = 3100;

describe.skipIf(!env)("reservations, the public side, on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let date: string;
  const run = randomUUID().slice(0, 8);
  const slug = `osteria-demo-${run}`;
  // One customer per run, so an e-mail from an earlier run in the same Mailpit is never mistaken for this one.
  const customer = {
    name: "Cliente Demo",
    phone: "+39 000 0000001",
    email: `cliente.demo.${run}@example.com`,
  };
  let formToken = "";
  let reservationId = "";
  let cancelToken = "";

  const staff = async <T = Record<string, unknown>>(
    user: TestUser,
    handler: unknown,
    path: string,
    init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
  ): Promise<Reply<T>> =>
    asUser.store!.run(user.client, async () => {
      const method = init.method ?? "GET";
      const response = await (handler as Handler)(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: method === "GET" ? {} : { "content-type": "application/json" },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
        { params: Promise.resolve(init.params ?? {}) },
      );
      return {
        status: response.status,
        body: (await response.json()) as T,
        headers: response.headers,
      };
    });

  const publicCall = async <T = Record<string, unknown>>(
    handler: unknown,
    path: string,
    init: { method?: string; body?: unknown; ip?: string; slug?: string } = {},
  ): Promise<Reply<T>> => {
    const method = init.method ?? "GET";
    const response = await (handler as Handler)(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers:
          method === "GET"
            ? {}
            : {
                "content-type": "application/json",
                origin: ORIGIN,
                ...(init.ip ? { "x-forwarded-for": init.ip } : {}),
              },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      { params: Promise.resolve({ slug: init.slug ?? slug }) },
    );
    return {
      status: response.status,
      body: (await response.json()) as T,
      headers: response.headers,
    };
  };

  const requestBody = (overrides: Record<string, unknown> = {}) => ({
    date,
    serviceKey: "cena",
    time: "20:00",
    party: 4,
    ...customer,
    locale: "it",
    privacyAck: true,
    website: "",
    formToken,
    ...overrides,
  });
  const sendRequest = (overrides: Record<string, unknown> = {}, ip = "203.0.113.10") =>
    publicCall(requestsRoute.POST, `/api/public/reservations/${slug}/requests`, {
      method: "POST",
      body: requestBody(overrides),
      ip,
    });
  const runMailJobOnce = async () => {
    const response = await cronRoute.POST(
      new Request(`${ORIGIN}/api/cron/reservation-mail`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { handled: number; sent: number; failed: number };
  };
  // One run claims only the oldest 10 due rows; other suites may have left more queued, so run until it handles none (at most 10 rounds).
  const runMailJob = () => drainMailJob(runMailJobOnce);
  const reservationCount = async () => {
    const { count, error } = await stack.admin
      .from("reservation")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", a.id);
    expect(error).toBeNull();
    return count ?? 0;
  };

  beforeAll(async () => {
    expect(mailpitUrl, "MAILPIT_URL or E2E_MAILPIT_URL").not.toBe("");
    expect(process.env.CRON_SECRET).toBeTruthy();
    stack = await createStack(env!);
    a = stack.tenantA;
    const tiles = await staff<TablesList>(a.owner, tablesRoute.GET, "/api/tables");
    expect(tiles.status).toBe(200);
    // Three days out: past the 2-hour lead time and inside the 60-day horizon, whatever time the run starts.
    date = addDays(tiles.body.businessDate, 3);
  }, 300_000);

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("the owner switches the page on with fake privacy data and Cena's booking times", async () => {
    const saved = await staff(a.owner, settingsRoute.PATCH, "/api/settings/reservations", {
      method: "PATCH",
      body: {
        publicSlug: slug,
        privacyControllerName: "Osteria Demo S.r.l. (demo)",
        privacyContactEmail: "privacy@example.com",
        services: [
          {
            key: "cena",
            online: true,
            firstSeating: "19:00",
            lastSeating: "21:30",
            coversPerSlot: null,
            reservationsPerSlot: null,
            coversPerService: null,
          },
        ],
      },
    });
    expect(saved.status).toBe(200);
    const on = await staff<{ enabled: boolean; ready: boolean }>(
      a.owner,
      settingsRoute.PATCH,
      "/api/settings/reservations",
      { method: "PATCH", body: { enabled: true } },
    );
    expect(on.status).toBe(200);
    expect([on.body.enabled, on.body.ready]).toEqual([true, true]);
  });

  it("GET page is 200 with the venue, the privacy block and a signed form token, and no cookie or staff data", async () => {
    const page = await publicCall<{
      venueName: string;
      services: { key: string }[];
      privacy: { controllerName: string; noticeVersion: string };
      formToken: string;
    }>(pageRoute.GET, `/api/public/reservations/${slug}/page`);
    expect(page.status).toBe(200);
    expect(page.body.venueName).toBe("Osteria Demo A");
    expect(page.body.services.map((s) => s.key)).toContain("cena");
    expect(page.body.privacy.controllerName).toBe("Osteria Demo S.r.l. (demo)");
    expect(page.body.formToken).toMatch(/^f1\.[0-9a-f]{8}\.\d+\.[0-9a-f]{64}$/);
    expect(page.headers.get("set-cookie")).toBeNull();
    formToken = page.body.formToken;
  });

  it("GET slots lists 20:00 for the date, without any count", async () => {
    const slots = await publicCall<{
      closed: boolean;
      services: { key: string; slots: { time: string; available: boolean }[] }[];
    }>(slotsRoute.GET, `/api/public/reservations/${slug}/slots?date=${date}&party=4`);
    expect(slots.status).toBe(200);
    const cena = slots.body.services.find((s) => s.key === "cena")!;
    expect(cena.slots.find((s) => s.time === "20:00")?.available).toBe(true);
    expect(Object.keys(cena.slots[0]!).sort()).toEqual(["available", "time"]);
  });

  it("a request sent too fast is 422 form_too_fast and writes nothing; after 3 s it is 202", async () => {
    const before = await reservationCount();
    const fast = await sendRequest();
    expect(fast.status).toBe(422);
    expect((fast.body as { error: { code: string } }).error.code).toBe("form_too_fast");
    expect(await reservationCount()).toBe(before);

    await new Promise((resolve) => setTimeout(resolve, FORM_MIN_WAIT_MS));
    const sent = await sendRequest();
    expect(sent.status).toBe(202);
    expect(sent.body).toEqual({ status: "received" });
    expect(await reservationCount()).toBe(before + 1);
  });

  it("the cron route sends the 'received' e-mail to the customer, with a cancel link", async () => {
    const job = await runMailJob();
    expect(job.sent).toBeGreaterThanOrEqual(1);
    const mail = await waitForMail(mailpitUrl, customer.email, { subject: /ricevuta/i });
    const link = cancelLinkFrom(mail.text);
    expect(link, "the received e-mail has a cancel link").not.toBeNull();
    expect(link!.slug).toBe(slug);
    expect(link!.url.startsWith(`${ORIGIN}/prenota/`)).toBe(true);
    expect(mail.text).toContain("Cliente Demo");
    expect(mail.text).not.toMatch(/€|tavol/i);
    cancelToken = link!.token;
  });

  it("a direct PostgREST call of request_reservation with the publishable key and a made-up gate is gate_invalid, and writes nothing", async () => {
    const before = await reservationCount();
    const anon = createClient(env!.url, env!.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.rpc("request_reservation", {
      p_slug: slug,
      p_gate_ts: Math.floor(Date.now() / 1000),
      p_gate_mac: "0".repeat(64),
      p_body: {
        date,
        serviceKey: "cena",
        time: "20:30",
        party: 2,
        ...customer,
        locale: "it",
        privacyNoticeVersion: "x",
      },
      p_ip: "203.0.113.50",
    });
    expect(error?.message).toBe("gate_invalid");
    expect(await reservationCount()).toBe(before);
  });

  it("the sixth request from one x-forwarded-for address is 429 (five are allowed)", async () => {
    const ip = "203.0.113.99";
    const statuses: number[] = [];
    for (let n = 1; n <= 6; n++) {
      const reply = await sendRequest(
        {
          time: ["19:00", "19:15", "19:30", "19:45", "20:15", "20:30"][n - 1],
          name: `Cliente Demo ${n}`,
          phone: `+39 000 000010${n}`,
          email: `cliente.demo.${run}.${n}@example.com`,
        },
        ip,
      );
      statuses.push(reply.status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });

  it("the owner sees the first request as pending and accepts it; the cron route then sends the 'accepted' e-mail with a link", async () => {
    const day = await staff<{
      services: {
        key: string;
        reservations: { id: string; name: string | null; time: string; status: string }[];
      }[];
    }>(a.owner, dayRoute.GET, `/api/reservations?date=${date}`);
    expect(day.status).toBe(200);
    const row = day.body.services
      .flatMap((s) => s.reservations)
      .find((r) => r.name === customer.name && r.time === "20:00");
    expect(row, "the customer's request is on the day").toBeDefined();
    expect(row!.status).toBe("pending");
    reservationId = row!.id;

    const accepted = await staff(
      a.owner,
      acceptRoute.POST,
      `/api/reservations/${reservationId}/accept`,
      {
        method: "POST",
        body: { tableIds: null, groupId: null },
        params: { id: reservationId },
      },
    );
    expect(accepted.status).toBe(200);
    await runMailJob();
    const mail = await waitForMail(mailpitUrl, customer.email, { subject: /confermata/i });
    expect(cancelLinkFrom(mail.text)?.slug).toBe(slug);
  });

  it("opening the cancel link only shows the booking; POST cancels; a second POST says already", async () => {
    const path = `/api/public/reservations/${slug}/cancel`;
    const view = await publicCall<{ canCancel: boolean; status: string; party: number }>(
      cancelRoute.GET,
      `${path}?t=${encodeURIComponent(cancelToken)}`,
    );
    expect(view.status).toBe(200);
    expect(view.headers.get("x-robots-tag")).toBe("noindex");
    expect(view.body).toMatchObject({ canCancel: true, status: "accepted", party: 4 });
    expect(JSON.stringify(view.body)).not.toContain(customer.name);
    // The GET changed nothing.
    const still = await staff<{ services: { reservations: { id: string; status: string }[] }[] }>(
      a.owner,
      dayRoute.GET,
      `/api/reservations?date=${date}`,
    );
    expect(
      still.body.services.flatMap((s) => s.reservations).find((r) => r.id === reservationId)
        ?.status,
    ).toBe("accepted");

    const first = await publicCall(cancelRoute.POST, path, {
      method: "POST",
      body: { token: cancelToken },
    });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: "cancelled", already: false });
    const second = await publicCall(cancelRoute.POST, path, {
      method: "POST",
      body: { token: cancelToken },
    });
    expect(second.body).toEqual({ status: "cancelled", already: true });
  });

  it("a garbage token and another page's slug are the same 404 link_invalid", async () => {
    const path = `/api/public/reservations/${slug}/cancel`;
    const garbage = await publicCall(cancelRoute.GET, `${path}?t=garbage`);
    const foreign = await publicCall(
      cancelRoute.GET,
      `${path}?t=${encodeURIComponent(cancelToken)}`,
      {
        slug: "osteria-demo-zz",
      },
    );
    expect(garbage.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(garbage.body);
  });

  it("an unknown slug and a page the owner switched off give the same 404", async () => {
    const unknown = await publicCall(
      pageRoute.GET,
      "/api/public/reservations/osteria-demo-zz/page",
      {
        slug: "osteria-demo-zz",
      },
    );
    const off = await staff(a.owner, settingsRoute.PATCH, "/api/settings/reservations", {
      method: "PATCH",
      body: { enabled: false },
    });
    expect(off.status).toBe(200);
    const disabled = await publicCall(pageRoute.GET, `/api/public/reservations/${slug}/page`);
    expect(unknown.status).toBe(404);
    expect(disabled.status).toBe(404);
    expect(disabled.body).toEqual(unknown.body);
  });
});
