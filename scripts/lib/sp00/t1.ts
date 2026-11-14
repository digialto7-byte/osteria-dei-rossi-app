// SP0 spike (§3.4, S8), T1: does Supabase Auth hand the hook a session_id on every sign-in method, and keep it across a refresh and a
// TOTP step? The probe hook (scratch 01) echoes what it saw as the claim `sp0_in`. All I/O is injected, so the unit test drives it with
// fakes. The report holds booleans, status codes, error codes and the method name; never a token, an address, a link or a TOTP secret.
import {
  attemptCase,
  CheckCrash,
  claimsOf,
  notRun,
  refusedCase,
  type AuthResult,
  type Session,
} from "./common";
import type { MailRead } from "./mail";
import type { CaseReport, Cleanup } from "./report";

export interface T1Deps {
  createUser(
    email: string,
    password: string,
  ): Promise<{ id: string | null; status: number | null; code: string | null }>;
  deleteUser(id: string): Promise<{ error: unknown }>;
  passwordSignIn(email: string, password: string): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  /** Local: asks Auth to mail a code and a link (`signInWithOtp`, `shouldCreateUser: false`). */
  sendCode(email: string): Promise<void>;
  /** Local: the newest mail for the address whose id is not in `knownIds`. */
  mailMessage(email: string, knownIds: string[]): Promise<MailRead>;
  /** Hosted: `auth.admin.generateLink({ type: 'magiclink' })`. No mail is sent. */
  generateLink(email: string): Promise<{
    status: number | null;
    code: string | null;
    emailOtp: string | null;
    actionLink: string | null;
  }>;
  /** `verifyOtp({ type: 'email' })`. */
  verifyEmailCode(email: string, code: string): Promise<AuthResult>;
  /**
   * Local case 3: `signInWithOtp` from a PKCE server client with a cookie jar. The handle keeps that client; on a refusal it is null and
   * the status and code say why.
   */
  pkceStart(
    email: string,
  ): Promise<{ handle: unknown; status: number | null; code: string | null }>;
  /** Waits; case 3 uses it once, past Auth's per-address mail interval, after a 429. */
  sleep(ms: number): Promise<void>;
  /** Follows a link once with `redirect: 'manual'`. */
  followRedirect(url: string): Promise<{ status: number; location: string | null }>;
  /** Local case 3: `exchangeCodeForSession` on the client of `pkceStart`. */
  pkceExchange(handle: unknown, code: string): Promise<AuthResult>;
  enrolTotp(accessToken: string): Promise<{
    status: number | null;
    code: string | null;
    factorId: string | null;
    secret: string | null;
  }>;
  verifyTotp(accessToken: string, factorId: string, code: string): Promise<AuthResult>;
  /** The current 6-digit TOTP code for a secret (e2e/helpers/totp.ts). */
  totpCode(secret: string): string;
  newId(): string;
  /** A 43-character random password. */
  newPassword(): string;
}

export interface T1Outcome {
  cases: CaseReport[];
  cleanup: Cleanup;
}

const CASE_IDS = ["1", "2", "3", "4", "5"] as const;

const NO_SESSION_1 = "no session from case 1";

/**
 * Case 3 asks for a second mail to the same address after case 2. Auth refuses a mail inside its per-address interval
 * (`[auth.email] max_frequency`, 1 s locally) with 429. So case 3 first waits MAIL_SPACING_MS past case 2's mail; if Auth still answers
 * 429 it waits MAIL_RETRY_MS and asks once more (the plan's "429: re-run once"), recording `retried`.
 */
export const MAIL_SPACING_MS = 1500;
export const MAIL_RETRY_MS = 2000;

function refusedOrRate(id: string, status: number | null, code: string | null): CaseReport {
  return { id, result: status === 429 ? "inconclusive" : "fail", detail: { status, code } };
}

/** Judges one issued session against the probe: sid true, a session_id present, and the same session as the baseline when there is one. */
function judge(
  id: string,
  result: AuthResult,
  baseline: string | null,
  flow: string | null,
): CaseReport {
  const withFlow = (detail: CaseReport["detail"]): CaseReport["detail"] =>
    flow === null ? detail : { ...detail, flow };
  if (result.session === null) {
    const refused = refusedOrRate(id, result.status, result.code);
    return { ...refused, detail: withFlow(refused.detail) };
  }
  const claims = claimsOf(result.session.accessToken);
  if (claims === null)
    return { id, result: "fail", detail: withFlow({ reason: "token not readable" }) };
  const probe = claims.sp0_in;
  if (probe === null || typeof probe !== "object" || Array.isArray(probe)) {
    return { id, result: "fail", detail: withFlow({ reason: "probe hook not installed" }) };
  }
  const { m, sid } = probe as { m?: unknown; sid?: unknown };
  const sessionId =
    typeof claims.session_id === "string" && claims.session_id !== "" ? claims.session_id : null;
  const detail: CaseReport["detail"] = {
    m: typeof m === "string" ? m : null,
    sid: sid === true,
    sessionIdPresent: sessionId !== null,
    aal: typeof claims.aal === "string" ? claims.aal : null,
  };
  let sameSession = true;
  if (baseline !== null) {
    sameSession = sessionId === baseline;
    detail.sameSession = sameSession;
  }
  const pass = sid === true && sessionId !== null && sameSession;
  return { id, result: pass ? "pass" : "fail", detail: withFlow(detail) };
}

const sessionIdOf = (session: Session): string | null => {
  const id = claimsOf(session.accessToken)?.session_id;
  return typeof id === "string" && id !== "" ? id : null;
};

export async function runT1(
  deps: T1Deps,
  target: "local" | "temp",
  preflight: CaseReport | null,
): Promise<T1Outcome> {
  if (target === "temp" && preflight === null) {
    throw new Error("T1 on the temporary project needs the preflight result first.");
  }
  if (preflight !== null && preflight.result !== "pass") {
    return {
      cases: notRun(CASE_IDS, "preflight failed"),
      cleanup: { created: 0, deleted: 0, kept: 0 },
    };
  }

  const idPart = deps
    .newId()
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  const email = `sp0-t1-${idPart}@example.test`;
  const password = deps.newPassword();
  const made = await deps.createUser(email, password);
  if (made.id === null) {
    const result = made.status === 429 ? "inconclusive" : "fail";
    return {
      cases: [{ id: "setup", result, detail: { status: made.status, code: made.code } }],
      cleanup: { created: 0, deleted: 0, kept: 0 },
    };
  }
  const userId = made.id;
  const cases: CaseReport[] = [];
  const knownMails: string[] = [];
  const hosted = target === "temp";
  let latest: Session | null = null;
  let baseline: string | null = null;

  // attemptCase never throws, so the removal below always runs.
  // Case 1: password. Its session is the baseline for cases 4 and 5.
  cases.push(
    await attemptCase("1", async () => {
      const result = await deps.passwordSignIn(email, password);
      if (result.session !== null) {
        latest = result.session;
        baseline = sessionIdOf(result.session);
      }
      return judge("1", result, null, null);
    }),
  );

  // Case 2: e-mail code. Local: the app's path through the mail catcher. Hosted: generateLink's OTP, no mail.
  cases.push(
    await attemptCase("2", async () => {
      const flow = hosted ? "generateLink" : "mailpit";
      let code: string | null;
      if (hosted) {
        const generated = await deps.generateLink(email);
        code = generated.emailOtp;
        if (code === null)
          return {
            id: "2",
            result: "fail",
            detail: { reason: "generateLink gave no code", status: generated.status, flow },
          };
      } else {
        await deps.sendCode(email);
        const mail = await deps.mailMessage(email, [...knownMails]);
        knownMails.push(mail.id);
        code = mail.code;
        if (code === null)
          return { id: "2", result: "fail", detail: { reason: "the mail has no code", flow } };
      }
      return judge("2", await deps.verifyEmailCode(email, code), null, flow);
    }),
  );

  // Case 3: magic link. Local: PKCE, the link's code is exchanged (the app's path). Hosted: a second generateLink, implicit flow.
  cases.push(
    await attemptCase("3", async () => {
      if (hosted) {
        const flow = "implicit";
        const generated = await deps.generateLink(email);
        if (generated.actionLink === null) {
          return {
            id: "3",
            result: "fail",
            detail: { reason: "generateLink gave no link", status: generated.status, flow },
          };
        }
        const redirect = await deps.followRedirect(generated.actionLink);
        const fragment =
          redirect.location === null
            ? ""
            : new URL(redirect.location, "http://placeholder.invalid").hash.slice(1);
        const params = new URLSearchParams(fragment);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken === null || refreshToken === null) {
          return {
            id: "3",
            result: "fail",
            detail: { reason: "no tokens in the redirect", status: redirect.status, flow },
          };
        }
        return judge(
          "3",
          { status: 200, code: null, session: { accessToken, refreshToken } },
          null,
          flow,
        );
      }
      await deps.sleep(MAIL_SPACING_MS);
      let start = await deps.pkceStart(email);
      const retried = start.status === 429;
      if (retried) {
        await deps.sleep(MAIL_RETRY_MS);
        start = await deps.pkceStart(email);
      }
      if (start.handle === null)
        return refusedCase("3", start.status, start.code, { flow: "pkce", retried });
      const handle = start.handle;
      const mail = await deps.mailMessage(email, [...knownMails]);
      knownMails.push(mail.id);
      if (mail.link === null)
        return { id: "3", result: "fail", detail: { reason: "the mail has no link" } };
      const redirect = await deps.followRedirect(mail.link);
      const code =
        redirect.location === null
          ? null
          : new URL(redirect.location, "http://placeholder.invalid").searchParams.get("code");
      if (code === null)
        return {
          id: "3",
          result: "fail",
          detail: { reason: "no code in the redirect", status: redirect.status },
        };
      const judged = judge("3", await deps.pkceExchange(handle, code), null, "pkce");
      return { ...judged, detail: { ...judged.detail, retried } };
    }),
  );

  // Case 4: token refresh keeps the session of case 1.
  cases.push(
    await attemptCase("4", async () => {
      if (latest === null)
        return { id: "4", result: "inconclusive", detail: { reason: NO_SESSION_1 } };
      const result = await deps.refresh(latest.refreshToken);
      if (result.session !== null) latest = result.session;
      return judge("4", result, baseline, null);
    }),
  );

  // Case 5: TOTP enrolment and verification keep it too.
  cases.push(
    await attemptCase("5", async () => {
      if (latest === null)
        return { id: "5", result: "inconclusive", detail: { reason: NO_SESSION_1 } };
      const enrolled = await deps.enrolTotp(latest.accessToken);
      if (enrolled.factorId === null || enrolled.secret === null)
        return refusedOrRate("5", enrolled.status, enrolled.code);
      const result = await deps.verifyTotp(
        latest.accessToken,
        enrolled.factorId,
        deps.totpCode(enrolled.secret),
      );
      return judge("5", result, baseline, null);
    }),
  );

  // The T1 user has no membership, so it can be deleted.
  let removal: { error: unknown };
  try {
    removal = await deps.deleteUser(userId);
  } catch (error) {
    throw new CheckCrash(error, { cases, cleanup: { created: 1, deleted: 0, kept: 1 } });
  }
  const undeleted = removal.error ? 1 : 0;
  if (undeleted > 0) cases.push({ id: "cleanup", result: "fail", detail: { undeleted } });
  return { cases, cleanup: { created: 1, deleted: 1 - undeleted, kept: undeleted } };
}
