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

// Keys that name a credential (a PIN, a password, a device token, an enrolment code, the pepper): the
// value under them is replaced whole, whatever it holds (M11, plan §3.1.13). A key is split into words
// (camelCase, snake_case, kebab-case, dots), so `deviceToken`, `access_token` and `PIN_PEPPER` match while
// `status_code`, `error_code`, `mapping` and `shipping` do not: "pin" inside another word is not a PIN.
const CREDENTIAL_WORDS = new Set([
  "pin",
  "pins",
  "password",
  "passwords",
  "token",
  "tokens",
  "pepper",
]);
// `code` alone, or with a qualifier that makes it a credential, is one; `status_code` is not.
const CODE_QUALIFIERS = new Set([
  "enrolment",
  "enrollment",
  "device",
  "auth",
  "otp",
  "magic",
  "invite",
]);

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function isCredentialKey(key: string): boolean {
  const words = keyWords(key);
  if (words.some((word) => CREDENTIAL_WORDS.has(word))) return true;
  const codeAt = words.indexOf("code");
  return codeAt !== -1 && (words.length === 1 || CODE_QUALIFIERS.has(words[codeAt - 1] ?? ""));
}
const REDACTED = "[redacted]";

/** Redacts email-shaped strings and credential-named values anywhere inside free-form event data. */
function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        isCredentialKey(key) && inner !== undefined && inner !== null
          ? REDACTED
          : redactDeep(inner),
      ]),
    ) as T;
  }
  return value;
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
  if (event.extra) scrubbed.extra = redactDeep(event.extra);
  if (event.contexts) scrubbed.contexts = redactDeep(event.contexts);
  if (event.tags) scrubbed.tags = redactDeep(event.tags);
  if (event.breadcrumbs) scrubbed.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);

  return scrubbed;
}
