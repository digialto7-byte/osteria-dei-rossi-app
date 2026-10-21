import { vi } from "vitest";

export interface FakeClaims {
  sub?: string;
  tenant_id?: string;
  app_role?: string;
}

/** A stand-in for the parts of the Supabase client the API layer calls. */
export function fakeSupabase(options: { claims?: FakeClaims | null; meRow?: unknown } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: options.meRow ?? null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: {
      getClaims: vi
        .fn()
        .mockResolvedValue(
          options.claims
            ? { data: { claims: options.claims }, error: null }
            : { data: null, error: null },
        ),
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({ select })),
    query: { select, eq, maybeSingle },
  };
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>;

export const OWNER_CLAIMS: FakeClaims = {
  sub: "a0000000-0000-4000-8000-00000000000a",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  app_role: "owner",
};

export function jsonRequest(url: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}
