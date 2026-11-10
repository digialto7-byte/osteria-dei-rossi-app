// Fixtures of the public reservation endpoints (fake data only: "Cliente Demo", example.com addresses, documentation IPs, fake keys).
import { signFormToken } from "@/server/reservations/public/tokens";

export const GATE_KEY = "test-gate-key-0123456789-abcdefghij";
export const LINK_KEY = "test-link-key-0123456789-abcdefghij";
export const SLUG = "osteria-demo-a";
export const NOW_MS = Date.parse("2026-11-20T10:00:00Z");

export const FAKE_CUSTOMER = {
  name: "Cliente Demo",
  phone: "+39 000 0000001",
  email: "cliente.demo@example.com",
  ip: "203.0.113.7",
};

export const PAGE_REPLY = {
  venueName: "Osteria Demo A",
  services: [{ key: "cena", name: "Cena" }],
  minDate: "2026-11-20",
  maxDate: "2027-01-19",
  closedWeekdays: [1],
  closedDates: ["2026-12-25"],
  maxPartyOnline: 8,
  venuePhone: null as string | null,
  privacy: {
    controllerName: "Osteria Demo S.r.l. (demo)",
    controllerVat: "IT00000000000",
    contactEmail: "privacy@example.com",
  },
};

export const SLOTS_REPLY = {
  date: "2026-11-27",
  closed: false,
  services: [
    {
      key: "cena",
      name: "Cena",
      slots: [
        { time: "19:00", available: true },
        { time: "19:15", available: false },
      ],
    },
  ],
};

/** A request as the page sends it, with a form token issued `ageMs` before `NOW_MS`. */
export function requestBody(overrides: Record<string, unknown> = {}, ageMs = 5000) {
  return {
    date: "2026-11-27",
    serviceKey: "cena",
    time: "20:00",
    party: 4,
    name: FAKE_CUSTOMER.name,
    phone: FAKE_CUSTOMER.phone,
    email: FAKE_CUSTOMER.email,
    locale: "it",
    privacyAck: true,
    website: "",
    formToken: signFormToken({ current: LINK_KEY }, SLUG, NOW_MS - ageMs),
    ...overrides,
  };
}
