// SP0 spike (§3.4, S7), T5: nobody can create an account by themselves, and a script-created owner signs in with the e-mail code.
// All I/O is injected, so the unit test drives it with fakes. The report holds statuses, error codes, counts and ids; never an address.
import type { CreateTenantInput } from "../create-tenant";
import { attemptCase, errorName } from "./common";
import type { CaseReport, Cleanup } from "./report";

export interface AttemptAnswer {
  status: number;
  code: string | null;
}

export interface T5Deps {
  /** `POST /auth/v1/signup` with the publishable key. `userId` is set when an account came back. */
  signUp(email: string, password: string): Promise<AttemptAnswer & { userId: string | null }>;
  /** `signInWithOtp({ shouldCreateUser: true })` for an unknown address. */
  otpForUnknown(email: string): Promise<AttemptAnswer & { accepted: boolean }>;
  /** `signInAnonymously()`. */
  anonymous(): Promise<AttemptAnswer & { userId: string | null }>;
  countUsers(): Promise<number>;
  findUserIdByEmail(email: string): Promise<string | null>;
  deleteUser(id: string): Promise<{ error: unknown }>;
  /** `createTenant` of scripts/create-tenant.ts with the spike's admin client. Returns the tenant id. */
  createTenant(input: CreateTenantInput): Promise<string>;
  /** Local: asks Auth to mail the code (`signInWithOtp`, `shouldCreateUser: false`). */
  sendCode(email: string): Promise<void>;
  /** Local: the 6-digit code from the mail catcher. */
  mailCode(email: string): Promise<string>;
  /** Hosted: the code from `auth.admin.generateLink` (no mail is sent). */
  generateCode(email: string): Promise<string>;
  /** `verifyOtp({ type: 'email' })`; `claims` are those of the issued access token, or null when refused. */
  verifyCode(
    email: string,
    code: string,
  ): Promise<{ status: number; claims: Record<string, unknown> | null }>;
  newId(): string;
}

export interface T5Outcome {
  cases: CaseReport[];
  cleanup: Cleanup;
}

const CASE_IDS = ["a", "b", "c", "d", "e"] as const;

type Kind = "accepted" | "refused" | "rate_limited" | "unknown";
/** The Auth error codes that mean "this way of getting an account is switched off" (names from @supabase/auth-js error-codes.ts). */
const OFF_CODES = {
  a: ["signup_disabled"],
  b: ["signup_disabled", "otp_disabled"],
  c: ["anonymous_provider_disabled"],
} as const;

/** A 4xx counts as refused only with a code that says the feature is off; any other 4xx (a bad address, a validation error) proves nothing. */
function classify(
  status: number,
  accepted: boolean,
  code: string | null,
  off: readonly string[],
): Kind {
  if (status === 429) return "rate_limited";
  if (accepted || (status >= 200 && status < 300)) return "accepted";
  if (status >= 400 && status < 500 && code !== null && off.includes(code)) return "refused";
  return "unknown";
}

export async function runT5(
  deps: T5Deps,
  target: "local" | "temp",
  preflight: CaseReport | null,
): Promise<T5Outcome> {
  if (target === "temp" && preflight === null) {
    throw new Error("T5 on the temporary project needs the preflight result first.");
  }
  if (preflight !== null && preflight.result !== "pass") {
    return {
      cases: CASE_IDS.map((id) => ({
        id,
        result: "inconclusive",
        detail: { reason: "preflight failed" },
      })),
      cleanup: { created: 0, deleted: 0, kept: 0 },
    };
  }

  const cases: CaseReport[] = [];
  let created = 0;
  let deleted = 0;
  let kept = 0;
  let undeleted = 0;
  const id8 = () =>
    deps
      .newId()
      .replace(/[^0-9a-f]/gi, "")
      .slice(0, 8)
      .toLowerCase();

  async function attempt(id: string, run: () => Promise<CaseReport>): Promise<void> {
    cases.push(await attemptCase(id, run));
  }

  /** A user the spike created by mistake (an accepted sign-up) and now removes. */
  async function removeCreated(userId: string): Promise<void> {
    created += 1;
    const { error } = await deps.deleteUser(userId);
    if (error) undeleted += 1;
    else deleted += 1;
  }

  const judge = (id: string, answer: AttemptAnswer, kind: Kind): CaseReport => ({
    id,
    result: kind === "refused" ? "pass" : kind === "accepted" ? "fail" : "inconclusive",
    detail: { status: answer.status, code: answer.code },
  });

  let before: number | null = null;
  let beforeError = "unknown";
  try {
    before = await deps.countUsers();
  } catch (error) {
    // Reported through case d (inconclusive), with the error's class name; the other cases still run.
    beforeError = errorName(error);
  }

  await attempt("a", async () => {
    const answer = await deps.signUp(
      `sp0-t5-signup-${id8()}@example.test`,
      `${deps.newId()}${deps.newId()}`,
    );
    const kind = classify(answer.status, answer.userId !== null, answer.code, OFF_CODES.a);
    if (answer.userId !== null) await removeCreated(answer.userId);
    return judge("a", answer, kind);
  });

  await attempt("b", async () => {
    const email = `sp0-t5-otp-${id8()}@example.test`;
    const answer = await deps.otpForUnknown(email);
    const kind = classify(answer.status, answer.accepted, answer.code, OFF_CODES.b);
    if (kind === "accepted") {
      const found = await deps.findUserIdByEmail(email);
      if (found !== null) await removeCreated(found);
    }
    return judge("b", answer, kind);
  });

  await attempt("c", async () => {
    const answer = await deps.anonymous();
    const kind = classify(answer.status, answer.userId !== null, answer.code, OFF_CODES.c);
    if (answer.userId !== null) await removeCreated(answer.userId);
    return judge("c", answer, kind);
  });

  await attempt("d", async (): Promise<CaseReport> => {
    if (before === null) {
      return {
        id: "d",
        result: "inconclusive",
        detail: { reason: "user count unavailable", error: beforeError },
      };
    }
    const after = await deps.countUsers();
    return after === before
      ? { id: "d", result: "pass", detail: { before, after } }
      : { id: "d", result: "fail", detail: { before, after } };
  });

  await attempt("e", async (): Promise<CaseReport> => {
    const email = `sp0-t5-owner-${id8()}@example.test`;
    const digits = deps.newId().replace(/\D/g, "").slice(0, 9).padEnd(9, "0");
    const tenantId = await deps.createTenant({
      name: "SP0 Test T5",
      vatNumber: `IT98${digits}`,
      ownerEmail: email,
      ownerName: "SP0 T5 Owner",
    });
    // The owner has a membership: it cannot be deleted and stays until the runner or the project is gone.
    created += 1;
    kept += 1;
    let code: string;
    if (target === "local") {
      await deps.sendCode(email);
      code = await deps.mailCode(email);
    } else {
      code = await deps.generateCode(email);
    }
    const flow = target === "local" ? "mailpit" : "generateLink";
    const answer = await deps.verifyCode(email, code);
    if (answer.status === 429) return { id: "e", result: "inconclusive", detail: { status: 429 } };
    if (answer.status !== 200 || answer.claims === null)
      return { id: "e", result: "fail", detail: { status: answer.status } };
    const tenantClaim = answer.claims.tenant_id === tenantId;
    return {
      id: "e",
      result: tenantClaim ? "pass" : "fail",
      detail: { status: answer.status, flow, tenantClaim },
    };
  });

  if (undeleted > 0) cases.push({ id: "cleanup", result: "fail", detail: { undeleted } });
  return { cases, cleanup: { created, deleted, kept } };
}
