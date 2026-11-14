// SP0 spike: the raw HTTPS calls of the checks that go to PostgREST, Storage and Auth with the PUBLISHABLE key and a USER token (never the
// secret key, which only clients.ts reads). They are plain `fetch` calls so that the checks see the status and error code as they are.
import type { AuthResult } from "./common";
import type { RestAnswer, StorageAnswer } from "./t2";

export interface HttpEnv {
  supabaseUrl: string;
  publishableKey: string;
  fetchImpl: typeof fetch;
}

/** A short error code from a GoTrue (`error_code`), PostgREST (`code`) or Storage (`error`) body, else null. */
export function codeOf(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const { error_code: errorCode, code, error } = body as Record<string, unknown>;
  const short = (value: unknown): string | null =>
    typeof value === "string" && /^[A-Za-z0-9_]{1,40}$/.test(value) ? value : null;
  return short(errorCode) ?? short(code) ?? short(error);
}

/** The JSON body of an answer, or null when it has none (an empty body, or a body that is not JSON: the status still says what happened). */
async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const headersFor = (
  env: HttpEnv,
  token: string | null,
  extra: Record<string, string> = {},
): Record<string, string> => ({
  apikey: env.publishableKey,
  ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
  ...extra,
});

export async function restCall(
  env: HttpEnv,
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<RestAnswer> {
  const response = await env.fetchImpl(`${env.supabaseUrl}/rest/v1${path}`, {
    method,
    headers: headersFor(
      env,
      token,
      method === "POST" ? { "Content-Type": "application/json" } : {},
    ),
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const parsed = await bodyOf(response);
  return { status: response.status, code: codeOf(parsed), body: parsed };
}

export async function signUpCall(
  env: HttpEnv,
  email: string,
  password: string,
): Promise<{ status: number; code: string | null; userId: string | null }> {
  const response = await env.fetchImpl(`${env.supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: headersFor(env, null, { "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  const parsed = (await bodyOf(response)) as { id?: unknown; user?: { id?: unknown } } | null;
  const id = parsed?.id ?? parsed?.user?.id;
  return {
    status: response.status,
    code: codeOf(parsed),
    userId: response.ok && typeof id === "string" ? id : null,
  };
}

const FAKE_PDF = new TextEncoder().encode(
  "%PDF-1.4\n% SP0 spike fake object, no client data\n%%EOF\n",
);

export async function storageUpload(
  env: HttpEnv,
  token: string,
  path: string,
): Promise<{ status: number; code: string | null }> {
  const response = await env.fetchImpl(`${env.supabaseUrl}/storage/v1/object/invoices/${path}`, {
    method: "POST",
    headers: headersFor(env, token, { "Content-Type": "application/pdf" }),
    body: FAKE_PDF,
  });
  return { status: response.status, code: codeOf(await bodyOf(response)) };
}

export async function storageList(
  env: HttpEnv,
  token: string,
  folder: string,
): Promise<StorageAnswer> {
  const response = await env.fetchImpl(`${env.supabaseUrl}/storage/v1/object/list/invoices`, {
    method: "POST",
    headers: headersFor(env, token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefix: folder, limit: 100, offset: 0 }),
  });
  const parsed = await bodyOf(response);
  return {
    status: response.status,
    code: codeOf(parsed),
    count: response.status === 200 && Array.isArray(parsed) ? parsed.length : null,
    bytes: null,
  };
}

export async function storageDownload(
  env: HttpEnv,
  token: string,
  path: string,
): Promise<StorageAnswer> {
  const response = await env.fetchImpl(
    `${env.supabaseUrl}/storage/v1/object/authenticated/invoices/${path}`,
    {
      method: "GET",
      headers: headersFor(env, token),
    },
  );
  if (response.status === 200) {
    return {
      status: 200,
      code: null,
      count: null,
      bytes: (await response.arrayBuffer()).byteLength,
    };
  }
  return {
    status: response.status,
    code: codeOf(await bodyOf(response)),
    count: null,
    bytes: null,
  };
}

export async function logoutCall(env: HttpEnv, token: string): Promise<{ status: number }> {
  const response = await env.fetchImpl(`${env.supabaseUrl}/auth/v1/logout`, {
    method: "POST",
    headers: headersFor(env, token),
  });
  return { status: response.status };
}

export async function totpEnrol(
  env: HttpEnv,
  token: string,
  friendlyName: string,
): Promise<{
  status: number;
  code: string | null;
  factorId: string | null;
  secret: string | null;
}> {
  const response = await env.fetchImpl(`${env.supabaseUrl}/auth/v1/factors`, {
    method: "POST",
    headers: headersFor(env, token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ factor_type: "totp", friendly_name: friendlyName }),
  });
  const parsed = (await bodyOf(response)) as { id?: unknown; totp?: { secret?: unknown } } | null;
  const id = parsed?.id;
  const secret = parsed?.totp?.secret;
  const good = response.ok && typeof id === "string" && typeof secret === "string";
  return {
    status: response.status,
    code: codeOf(parsed),
    factorId: good ? id : null,
    secret: good ? secret : null,
  };
}

export async function totpVerify(
  env: HttpEnv,
  token: string,
  factorId: string,
  code: string,
): Promise<AuthResult> {
  const challenge = await env.fetchImpl(
    `${env.supabaseUrl}/auth/v1/factors/${factorId}/challenge`,
    {
      method: "POST",
      headers: headersFor(env, token, { "Content-Type": "application/json" }),
      body: "{}",
    },
  );
  const challengeBody = (await bodyOf(challenge)) as { id?: unknown } | null;
  if (!challenge.ok || typeof challengeBody?.id !== "string") {
    return { status: challenge.status, code: codeOf(challengeBody), session: null };
  }
  const verify = await env.fetchImpl(`${env.supabaseUrl}/auth/v1/factors/${factorId}/verify`, {
    method: "POST",
    headers: headersFor(env, token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ challenge_id: challengeBody.id, code }),
  });
  const parsed = (await bodyOf(verify)) as {
    access_token?: unknown;
    refresh_token?: unknown;
  } | null;
  if (
    verify.ok &&
    typeof parsed?.access_token === "string" &&
    typeof parsed.refresh_token === "string"
  ) {
    return {
      status: verify.status,
      code: null,
      session: { accessToken: parsed.access_token, refreshToken: parsed.refresh_token },
    };
  }
  return { status: verify.status, code: codeOf(parsed), session: null };
}

/** Follows a link once without following the redirect; returns the status and the Location header. */
export async function followOnce(
  fetchImpl: typeof fetch,
  url: string,
): Promise<{ status: number; location: string | null }> {
  const response = await fetchImpl(url, { redirect: "manual" });
  return { status: response.status, location: response.headers.get("location") };
}
