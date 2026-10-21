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

  it("does not mutate the event it receives", () => {
    const original = event({ user: { id: "u1", email: "owner@example.test" } });
    scrubEvent(original);
    expect(original.user?.email).toBe("owner@example.test");
  });

  it("passes an event without request or user through", () => {
    expect(scrubEvent(event({ message: "plain" })).message).toBe("plain");
  });
});
