import { describe, expect, it } from "vitest";
import { NO_PERSONAL_DATA, sentryOptions } from "@/lib/observability/sentry";
import { scrubEvent } from "@/lib/observability/scrub";

describe("sentryOptions", () => {
  it("is disabled without a DSN", () => {
    expect(sentryOptions(undefined, "development")).toEqual({ enabled: false });
  });

  it("collects no personal data automatically and scrubs every event", () => {
    const options = sentryOptions("https://k@o1.ingest.sentry.io/1", "preview");
    expect(options).toMatchObject({
      enabled: true,
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "preview",
    });
    expect(options.dataCollection).toEqual(NO_PERSONAL_DATA);
    expect(NO_PERSONAL_DATA).toMatchObject({
      userInfo: false,
      cookies: false,
      urlQueryParams: false,
    });
    expect(options.beforeSend).toBe(scrubEvent);
  });
});
