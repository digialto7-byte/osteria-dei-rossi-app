import { vi } from "vitest";

export interface FakeClaims {
  sub?: string;
  tenant_id?: string;
  app_role?: string;
  /** Set by the access token hook for PIN sessions (ADR-010). */
  login?: string;
  session_state?: string;
  session_id?: string;
}

/** What a PostgREST call resolves to. */
export interface FakeResult {
  data: unknown;
  error: { code?: string; message: string; details?: string | null } | null;
  count?: number | null;
}

interface FakeOptions {
  claims?: FakeClaims | null;
  /** Shortcut for the app_user row /api/me reads. */
  meRow?: unknown;
  /** Results per table, returned in order; the last one repeats. */
  results?: Record<string, FakeResult[]>;
  /** Results per RPC function, returned in order; the last one repeats. */
  rpc?: Record<string, FakeResult[]>;
  /** Scripted Storage results, returned in order; the last one repeats. */
  storage?: {
    upload?: StorageResult[];
    createSignedUrl?: StorageResult[];
    download?: StorageResult[];
  };
}

/** What a Storage call resolves to. */
export interface StorageResult {
  data: unknown;
  error: { message: string; statusCode?: string } | null;
}

const CHAINABLE = [
  "select",
  "insert",
  "update",
  "upsert",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "in",
  "is",
  "ilike",
  "or",
  "order",
  "limit",
  "range",
] as const;

const EMPTY: FakeResult = { data: null, error: null };

function takeNext<T extends { data: unknown }>(
  queue: T[] | undefined,
  empty: T | FakeResult = EMPTY,
) {
  if (!queue || queue.length === 0) return empty as T;
  return (queue.length > 1 ? queue.shift() : queue[0]) ?? (empty as T);
}

const DEFAULT_UPLOAD: StorageResult = { data: { path: "fake/path" }, error: null };
const DEFAULT_SIGNED_URL: StorageResult = {
  data: { signedUrl: "https://storage.example.test/object/sign/fake?token=fake" },
  error: null,
};

const DEFAULT_DOWNLOAD: StorageResult = { data: new Blob([]), error: null };

/**
 * A stand-in for the parts of the Supabase client the API layer calls. Query builders are
 * chainable and awaitable like supabase-js; every chain method is a shared spy on `query`, so
 * tests can assert e.g. `client.query.eq` was called with ("auth_id", id).
 */
export function fakeSupabase(options: FakeOptions = {}) {
  const tables = new Map(Object.entries(options.results ?? {}).map(([t, r]) => [t, [...r]]));
  if (!tables.has("app_user")) {
    tables.set("app_user", [{ data: options.meRow ?? null, error: null }]);
  }
  const rpcs = new Map(Object.entries(options.rpc ?? {}).map(([f, r]) => [f, [...r]]));
  let currentTable = "";
  const uploads = [...(options.storage?.upload ?? [])];
  const signedUrls = [...(options.storage?.createSignedUrl ?? [])];
  const downloads = [...(options.storage?.download ?? [])];

  const resolveNext = () => Promise.resolve(takeNext(tables.get(currentTable)));
  const query = {
    single: vi.fn(resolveNext),
    maybeSingle: vi.fn(resolveNext),
    then: (
      onFulfilled: (value: FakeResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => resolveNext().then(onFulfilled, onRejected),
  } as unknown as Record<(typeof CHAINABLE)[number], ReturnType<typeof vi.fn>> & {
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: PromiseLike<FakeResult>["then"];
  };
  for (const method of CHAINABLE) query[method] = vi.fn(() => query);

  const upload = vi.fn(async (..._args: unknown[]) => takeNext(uploads, DEFAULT_UPLOAD));
  const createSignedUrl = vi.fn(async (..._args: unknown[]) =>
    takeNext(signedUrls, DEFAULT_SIGNED_URL),
  );
  const download = vi.fn(async (..._args: unknown[]) => takeNext(downloads, DEFAULT_DOWNLOAD));
  const bucketApi = { upload, createSignedUrl, download };

  return {
    auth: {
      getClaims: vi
        .fn()
        .mockResolvedValue(
          options.claims
            ? { data: { claims: options.claims }, error: null }
            : { data: null, error: null },
        ),
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn((table: string) => {
      currentTable = table;
      return query;
    }),
    storage: { from: vi.fn((_bucket: string) => bucketApi), upload, createSignedUrl, download },
    rpc: vi.fn((fn: string, _args?: unknown) => Promise.resolve(takeNext(rpcs.get(fn)))),
    query,
  };
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>;

export const OWNER_CLAIMS: FakeClaims = {
  sub: "a0000000-0000-4000-8000-00000000000a",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  app_role: "owner",
};

export const claimsFor = (role: string): FakeClaims => ({ ...OWNER_CLAIMS, app_role: role });

export function jsonRequest(url: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

/** The route context Next.js 16 passes to dynamic route handlers. */
export const routeContext = (params: Record<string, string>) => ({
  params: Promise.resolve(params),
});
