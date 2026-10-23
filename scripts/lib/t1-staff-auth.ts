// T1 spike logic (M11 plan step 0, AT8): can Supabase Auth carry staff PIN logins?
// All I/O is injected, so the unit test drives it with fakes. Nothing here prints a key, a
// password, a token or an e-mail address: the report holds check ids, pass/fail and counts only.
import { parseArgs } from "node:util";

const STAFF_DOMAIN = "staff.invalid";
const SEQUENTIAL_SIGN_INS = 30;

export type Target = "local" | "staging";

export interface AuthError {
  status?: number;
  code?: string;
}
export interface SpikeSession {
  access_token: string;
  refresh_token: string;
}
export interface SessionResult {
  session: SpikeSession | null;
  error: AuthError | null;
}

export interface SpikeDeps {
  admin: {
    createUser(attrs: {
      email: string;
      password: string;
      email_confirm: boolean;
    }): Promise<{ data: { user: { id: string } | null }; error: AuthError | null }>;
    updateUserById(id: string, attrs: { password: string }): Promise<{ error: AuthError | null }>;
    deleteUser(id: string): Promise<{ error: AuthError | null }>;
  };
  signIn(email: string, password: string): Promise<SessionResult>;
  refresh(refreshToken: string): Promise<SessionResult>;
  /** Messages in the mail catcher addressed to the staff domain; null when there is no catcher. */
  staffMailCount: (() => Promise<number>) | null;
  newId(): string;
  /** A fresh 43-character base64url password, the shape of a derived PIN password. */
  newPassword(): string;
}

export interface Check {
  id: "a" | "b" | "c" | "d" | "e";
  ok: boolean;
  skipped?: boolean;
  detail: string;
}
export interface SpikeReport {
  target: Target;
  ok: boolean;
  checks: Check[];
  cleanup: { created: number; deleted: number };
}

const isLocalUrl = (value: string) => {
  try {
    const { hostname } = new URL(value);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
};

/**
 * Local stack only, unless the founder has OK'd staging (plan M-1): that needs both
 * `--target staging` and T1_STAGING_OK=yes. No message repeats the URL.
 */
export function resolveTarget(input: {
  argv: string[];
  env: Record<string, string | undefined>;
  supabaseUrl: string;
}): Target {
  const { values } = parseArgs({
    args: input.argv,
    strict: true,
    options: { target: { type: "string" } },
  });
  if (values.target === undefined) {
    if (isLocalUrl(input.supabaseUrl)) return "local";
    throw new Error(
      "Refusing to run: the Supabase URL is not the local stack (127.0.0.1 or localhost).",
    );
  }
  if (values.target !== "staging") throw new Error("--target accepts only: staging");
  if (input.env.T1_STAGING_OK !== "yes") {
    throw new Error("Refusing --target staging: it needs the founder's OK, set T1_STAGING_OK=yes.");
  }
  if (isLocalUrl(input.supabaseUrl)) {
    throw new Error("--target staging was given but the Supabase URL is the local stack.");
  }
  return "staging";
}

function claimsOf(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1] ?? "";
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

const describeError = (error: AuthError | null) =>
  error ? `status ${error.status ?? "?"} ${error.code ?? "no_code"}` : "no error";

export async function runSpike(deps: SpikeDeps, target: Target): Promise<SpikeReport> {
  const checks: Check[] = [];
  const created: string[] = [];
  let deleted = 0;
  let cleanupFailed = false;
  const add = (check: Check) => checks.push(check);

  try {
    steps: {
      const email = `staff-${deps.newId()}@${STAFF_DOMAIN}`;
      const password = deps.newPassword();

      // (a) the synthetic address and a 43-character password are accepted.
      const made = await deps.admin.createUser({ email, password, email_confirm: true });
      const userId = made.data.user?.id;
      if (made.error || !userId) {
        add({ id: "a", ok: false, detail: `createUser refused: ${describeError(made.error)}` });
        break steps;
      }
      created.push(userId);
      add({ id: "a", ok: true, detail: "createUser accepted the synthetic address" });

      // (c) 30 sequential server-side sign-ins, none rate limited. Then the 31st, for information.
      let limited = 0;
      let failed = 0;
      let firstSession: SpikeSession | null = null;
      for (let i = 0; i < SEQUENTIAL_SIGN_INS; i += 1) {
        const result = await deps.signIn(email, password);
        if (result.error?.status === 429) limited += 1;
        else if (result.error || !result.session) failed += 1;
        firstSession ??= result.session;
      }
      const extra = await deps.signIn(email, password);
      const thirtyFirst = extra.error ? describeError(extra.error) : "ok";
      add({
        id: "c",
        ok: limited === 0 && failed === 0,
        detail: `${SEQUENTIAL_SIGN_INS} sequential sign-ins: ${limited} rate limited (429), ${failed} other failures; 31st: ${thirtyFirst}`,
      });

      // (e) session_id and amr in the access token, stable across a refresh.
      const claims = firstSession ? claimsOf(firstSession.access_token) : null;
      const sessionId = typeof claims?.session_id === "string" ? claims.session_id : null;
      const amr = Array.isArray(claims?.amr) ? (claims.amr as { method?: unknown }[]) : [];
      const method = amr[0]?.method;
      let refreshedSameSession = false;
      if (firstSession && sessionId) {
        const refreshed = await deps.refresh(firstSession.refresh_token);
        const after = refreshed.session ? claimsOf(refreshed.session.access_token) : null;
        refreshedSameSession = !refreshed.error && after?.session_id === sessionId;
      }
      add({
        id: "e",
        ok: sessionId !== null && method === "password" && refreshedSameSession,
        detail: `session_id present: ${sessionId !== null}; amr[0].method is password: ${method === "password"}; session_id unchanged after refresh: ${refreshedSameSession}`,
      });

      // (d) a password change takes effect at once: old one refused, new one signs in.
      const newPassword = deps.newPassword();
      const updated = await deps.admin.updateUserById(userId, { password: newPassword });
      if (updated.error) {
        add({
          id: "d",
          ok: false,
          detail: `updateUserById failed: ${describeError(updated.error)}`,
        });
      } else {
        const old = await deps.signIn(email, password);
        const fresh = await deps.signIn(email, newPassword);
        const oldRefused = old.error?.status === 400 && old.error.code === "invalid_credentials";
        const newWorks = !fresh.error && fresh.session !== null;
        add({
          id: "d",
          ok: oldRefused && newWorks,
          detail: `old password refused with 400 invalid_credentials: ${oldRefused}; new password signs in: ${newWorks}`,
        });
      }

      // (b) no mail was sent for (a) or (d).
      if (deps.staffMailCount) {
        const count = await deps.staffMailCount();
        add({ id: "b", ok: count === 0, detail: `${count} message(s) to the staff domain` });
      } else if (target === "staging") {
        add({
          id: "b",
          ok: true,
          skipped: true,
          detail: "no mail catcher on staging; not checked",
        });
      } else {
        add({ id: "b", ok: false, detail: "mail catcher URL not configured" });
      }
    }
  } catch (error) {
    // Class name only: a message could carry a URL or a value.
    add({
      id: "a",
      ok: false,
      detail: `unexpected ${error instanceof Error ? error.name : "error"} during the run`,
    });
  } finally {
    for (const id of created) {
      try {
        const { error } = await deps.admin.deleteUser(id);
        if (error) cleanupFailed = true;
        else deleted += 1;
      } catch {
        cleanupFailed = true;
      }
    }
  }
  return finish();

  function finish(): SpikeReport {
    checks.sort((x, y) => x.id.localeCompare(y.id));
    return {
      target,
      ok: !cleanupFailed && checks.length >= 5 && checks.every((check) => check.ok),
      checks,
      cleanup: { created: created.length, deleted },
    };
  }
}

/** One JSON line, safe to paste into the plan or a CI log. */
export function formatReport(report: SpikeReport): string {
  return JSON.stringify(report);
}
