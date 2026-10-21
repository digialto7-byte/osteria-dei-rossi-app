import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const KEPT_HEADERS = new Set(["user-agent", "content-type", "accept-language"]);

function redact(text: string | undefined): string | undefined {
  return text?.replace(EMAIL, "[email]");
}

function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const queryStart = url.search(/[?#]/);
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  return { ...crumb, message: redact(crumb.message), data: undefined };
}

/**
 * Sentry beforeSend: removes personal data and credentials (plan §3.11.8). Logs keep ids only:
 * no emails, cookies, tokens, request bodies or query strings (magic-link codes live there).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };

  if (event.user) scrubbed.user = event.user.id === undefined ? {} : { id: event.user.id };

  if (event.request) {
    const headers = Object.fromEntries(
      Object.entries(event.request.headers ?? {}).filter(([name]) =>
        KEPT_HEADERS.has(name.toLowerCase()),
      ),
    );
    scrubbed.request = {
      method: event.request.method,
      url: stripQuery(event.request.url),
      headers,
    };
  }

  if (event.exception?.values) {
    scrubbed.exception = {
      ...event.exception,
      values: event.exception.values.map((value) => ({ ...value, value: redact(value.value) })),
    };
  }

  if (event.message) scrubbed.message = redact(event.message);
  if (event.breadcrumbs) scrubbed.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);

  return scrubbed;
}
