import { describe, expect, it } from "vitest";
import { ConfigError, readMailEnv, readReservationEnv } from "@/lib/env";

// Reservations plan §5 B6: the public routes and the mail cron read their own variables, never part of serverSchema, so the rest
// of the app boots without them. Fake keys only.
const GATE = "test-gate-key-0123456789-abcdefghij";
const LINK = "test-link-key-0123456789-abcdefghij";
const PREVIOUS = "test-previous-key-0123456789-abcdefg";

const names = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).variables;
  }
  throw new Error("expected a ConfigError");
};

describe("readReservationEnv", () => {
  it("returns the gate key, the link key and no previous key", () => {
    expect(readReservationEnv({ RESERVATION_GATE_KEY: GATE, RESERVATION_LINK_KEY: LINK })).toEqual({
      gateKey: GATE,
      linkKey: LINK,
      linkKeyPrevious: undefined,
    });
  });

  it("returns the previous link key when it is set, and treats an empty one as unset", () => {
    const base = { RESERVATION_GATE_KEY: GATE, RESERVATION_LINK_KEY: LINK };
    expect(
      readReservationEnv({ ...base, RESERVATION_LINK_KEY_PREVIOUS: PREVIOUS }).linkKeyPrevious,
    ).toBe(PREVIOUS);
    expect(readReservationEnv({ ...base, RESERVATION_LINK_KEY_PREVIOUS: "" }).linkKeyPrevious).toBe(
      undefined,
    );
  });

  it("requires at least 32 characters for each key (31 fails, 32 passes)", () => {
    const ok = { RESERVATION_GATE_KEY: GATE, RESERVATION_LINK_KEY: LINK };
    expect(
      readReservationEnv({ ...ok, RESERVATION_GATE_KEY: "x".repeat(32) }).gateKey,
    ).toHaveLength(32);
    expect(
      names(() => readReservationEnv({ ...ok, RESERVATION_GATE_KEY: "x".repeat(31) })),
    ).toEqual(["RESERVATION_GATE_KEY"]);
    expect(
      names(() => readReservationEnv({ ...ok, RESERVATION_LINK_KEY: "x".repeat(31) })),
    ).toEqual(["RESERVATION_LINK_KEY"]);
    expect(
      names(() => readReservationEnv({ ...ok, RESERVATION_LINK_KEY_PREVIOUS: "x".repeat(31) })),
    ).toEqual(["RESERVATION_LINK_KEY_PREVIOUS"]);
  });

  it("names every missing or empty variable and never a value", () => {
    expect(names(() => readReservationEnv({}))).toEqual([
      "RESERVATION_GATE_KEY",
      "RESERVATION_LINK_KEY",
    ]);
    expect(
      names(() => readReservationEnv({ RESERVATION_GATE_KEY: "", RESERVATION_LINK_KEY: LINK })),
    ).toEqual(["RESERVATION_GATE_KEY"]);
    try {
      readReservationEnv({
        RESERVATION_GATE_KEY: "short-secret-value",
        RESERVATION_LINK_KEY: LINK,
      });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).message).not.toContain("short-secret-value");
    }
  });
});

describe("readMailEnv", () => {
  const mailpit = {
    MAIL_TRANSPORT: "mailpit",
    MAIL_FROM: "prenotazioni@example.com",
    MAILPIT_URL: "http://127.0.0.1:54324",
    APP_PUBLIC_ORIGIN: "http://localhost:3000",
  };
  const resend = {
    MAIL_TRANSPORT: "resend",
    MAIL_FROM: "prenotazioni@example.com",
    RESEND_API_KEY: "test-key",
    APP_PUBLIC_ORIGIN: "https://app.example.com",
  };

  it("reads the mailpit setup", () => {
    expect(readMailEnv(mailpit)).toMatchObject({
      transport: "mailpit",
      from: "prenotazioni@example.com",
      mailpitUrl: "http://127.0.0.1:54324",
      appPublicOrigin: "http://localhost:3000",
    });
  });

  it("reads the resend setup, and keeps only the origin of APP_PUBLIC_ORIGIN", () => {
    expect(readMailEnv({ ...resend, APP_PUBLIC_ORIGIN: "https://app.example.com/" })).toMatchObject(
      { transport: "resend", resendApiKey: "test-key", appPublicOrigin: "https://app.example.com" },
    );
  });

  it("refuses mailpit in production, and allows it in preview and development", () => {
    expect(
      names(() =>
        readMailEnv({
          ...mailpit,
          APP_PUBLIC_ORIGIN: "https://app.example.com",
          VERCEL_ENV: "production",
        }),
      ),
    ).toEqual(["MAIL_TRANSPORT"]);
    expect(readMailEnv({ ...mailpit, VERCEL_ENV: "preview" }).transport).toBe("mailpit");
    expect(readMailEnv({ ...mailpit, VERCEL_ENV: "development" }).transport).toBe("mailpit");
  });

  it("refuses resend without RESEND_API_KEY and mailpit without MAILPIT_URL", () => {
    expect(names(() => readMailEnv({ ...resend, RESEND_API_KEY: "" }))).toEqual(["RESEND_API_KEY"]);
    expect(names(() => readMailEnv({ ...mailpit, MAILPIT_URL: undefined }))).toEqual([
      "MAILPIT_URL",
    ]);
  });

  it("refuses an unknown transport, a missing sender and a missing origin", () => {
    expect(names(() => readMailEnv({ ...resend, MAIL_TRANSPORT: "smtp" }))).toEqual([
      "MAIL_TRANSPORT",
    ]);
    expect(names(() => readMailEnv({ ...resend, MAIL_FROM: "" }))).toEqual(["MAIL_FROM"]);
    expect(names(() => readMailEnv({ ...resend, APP_PUBLIC_ORIGIN: "" }))).toEqual([
      "APP_PUBLIC_ORIGIN",
    ]);
  });

  it("requires https for the public origin in production", () => {
    expect(
      names(() =>
        readMailEnv({
          ...resend,
          APP_PUBLIC_ORIGIN: "http://app.example.com",
          VERCEL_ENV: "production",
        }),
      ),
    ).toEqual(["APP_PUBLIC_ORIGIN"]);
  });

  it("never puts the API key in the error", () => {
    try {
      readMailEnv({ ...resend, MAIL_FROM: "", RESEND_API_KEY: "test-key-secret" });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).message).not.toContain("test-key-secret");
    }
  });
});
