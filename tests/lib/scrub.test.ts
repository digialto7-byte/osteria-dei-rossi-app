import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubEvent } from "@/lib/observability/scrub";

function event(partial: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...partial } as ErrorEvent;
}

describe("scrubEvent", () => {
  it("drops cookies, auth headers, request bodies and the user's personal fields", () => {
    const scrubbed = scrubEvent(
      event({
        user: { id: "u1", email: "owner@example.test", ip_address: "203.0.113.9", username: "x" },
        request: {
          url: "https://app.example/api/auth/callback?code=secret-code&next=/",
          query_string: "code=secret-code&next=/",
          cookies: { "sb-access-token": "jwt" },
          headers: { authorization: "Bearer jwt", cookie: "a=b", "user-agent": "UA" },
          data: '{"email":"owner@example.test"}',
        },
      }),
    );
    expect(scrubbed.user).toEqual({ id: "u1" });
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.headers).toEqual({ "user-agent": "UA" });
    expect(scrubbed.request?.query_string).toBeUndefined();
    expect(scrubbed.request?.url).toBe("https://app.example/api/auth/callback");
    expect(JSON.stringify(scrubbed)).not.toContain("secret-code");
    expect(JSON.stringify(scrubbed)).not.toContain("owner@example.test");
  });

  it("redacts email addresses in exception messages and breadcrumbs", () => {
    const scrubbed = scrubEvent(
      event({
        exception: { values: [{ type: "Error", value: "no user owner@example.test" }] },
        breadcrumbs: [{ message: "sent link to owner@example.test" }],
      }),
    );
    expect(JSON.stringify(scrubbed)).not.toContain("owner@example.test");
    expect(scrubbed.exception?.values?.[0]?.value).toBe("no user [email]");
  });

  it("redacts email addresses in extra data, contexts and tags", () => {
    const scrubbed = scrubEvent(
      event({
        extra: { email: "owner@example.test", nested: { list: ["chef@example.test", 3] } },
        contexts: { invoice: { sender: "fornitore@example.test" } },
        tags: { recipient: "owner@example.test", step: "send" },
      }),
    );
    expect(JSON.stringify(scrubbed)).not.toMatch(/@example\.test/);
    expect(scrubbed.extra).toEqual({ email: "[email]", nested: { list: ["[email]", 3] } });
    expect(scrubbed.tags).toEqual({ recipient: "[email]", step: "send" });
  });

  it("does not mutate the event it receives", () => {
    const original = event({ user: { id: "u1", email: "owner@example.test" } });
    scrubEvent(original);
    expect(original.user?.email).toBe("owner@example.test");
  });

  it("passes an event without request or user through", () => {
    expect(scrubEvent(event({ message: "plain" })).message).toBe("plain");
  });

  // M11 acceptance test 5 (Sentry half): a PIN, a password, a device token or an enrolment code
  // must never leave the process, whatever the key casing or nesting.
  describe("credential keys (M11)", () => {
    const SECRETS = { pin: "4827", password: "x-secret", deviceToken: "tok-123", code: "K7M2QX9P" };

    it("redacts the value of pin, password, token, code and pepper keys in extra, contexts and tags", () => {
      const scrubbed = scrubEvent(
        event({
          extra: { ...SECRETS, nested: { list: [{ PIN: "4827" }], keep: "visible" } },
          contexts: { login: { ...SECRETS, userId: "u1" } },
          tags: { pinCode: "4827", step: "login" },
        }),
      );
      const text = JSON.stringify(scrubbed);
      for (const value of Object.values(SECRETS)) expect(text).not.toContain(value);
      expect(scrubbed.extra).toMatchObject({
        pin: "[redacted]",
        password: "[redacted]",
        deviceToken: "[redacted]",
        code: "[redacted]",
        nested: { list: [{ PIN: "[redacted]" }], keep: "visible" },
      });
      expect(scrubbed.contexts).toMatchObject({ login: { pin: "[redacted]", userId: "u1" } });
      expect(scrubbed.tags).toEqual({ pinCode: "[redacted]", step: "login" });
    });

    it("redacts a whole object or array held under a credential key", () => {
      const scrubbed = scrubEvent(
        event({ extra: { tokens: ["a", "b"], pepperConfig: { v: "p" } } }),
      );
      expect(scrubbed.extra).toEqual({ tokens: "[redacted]", pepperConfig: "[redacted]" });
    });

    it("breadcrumb data carrying credentials is gone", () => {
      const scrubbed = scrubEvent(
        event({ breadcrumbs: [{ message: "POST /api/auth/pin", data: { ...SECRETS } }] }),
      );
      const text = JSON.stringify(scrubbed);
      for (const value of Object.values(SECRETS)) expect(text).not.toContain(value);
      expect(scrubbed.breadcrumbs?.[0]?.message).toBe("POST /api/auth/pin");
    });

    it.each([
      "pin",
      "PIN",
      "password",
      "token",
      "deviceToken",
      "code",
      "enrolmentCode",
      "enrollment_code",
      "pepper",
      "PIN_PEPPER",
      "access_token",
      "refresh-token",
      "accessToken",
      "PINCode",
      "device.token",
    ])("redacts the credential key %s", (key) => {
      const scrubbed = scrubEvent(event({ extra: { [key]: "s3cret-value" } }));
      expect(scrubbed.extra).toEqual({ [key]: "[redacted]" });
    });

    it.each([
      "status_code",
      "statusCode",
      "error_code",
      "errorCode",
      "mapping",
      "shipping",
      "pinned",
      "opinion",
      "tokenizer",
      "encoded",
      "http_status_code",
      "postcode",
    ])("keeps the harmless key %s", (key) => {
      const scrubbed = scrubEvent(event({ extra: { [key]: "visible" } }));
      expect(scrubbed.extra).toEqual({ [key]: "visible" });
    });

    it("keeps keys that merely resemble nothing sensitive, and the email redaction", () => {
      const scrubbed = scrubEvent(event({ extra: { email: "a@example.test", count: 3 } }));
      expect(scrubbed.extra).toEqual({ email: "[email]", count: 3 });
    });
  });
});
