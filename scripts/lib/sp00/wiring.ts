// SP0 spike: connects the check modules (t1, t2, t3, t5) to the real clients. Thin glue, like scripts/spike/t1-staff-auth.ts: the logic
// it calls is unit-tested with fakes, and this file is proven by the CI workflow (local stack) and the run day (temporary project).
// The secret key is held only by the admin client built in clients.ts; this file never handles its value.
import { randomBytes, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type AuthError, type SupabaseClient } from "@supabase/supabase-js";
import { totpAt } from "../../../e2e/helpers/totp";
import { createTenant } from "../create-tenant";
import { readAuthVersion, type AuthContext } from "./auth-entry";
import { claimsOf, type AuthResult } from "./common";
import {
  createAdminClient,
  createUserClient,
  preflight,
  readSpikeEnv,
  secretsToRedact,
  type SpikeEnv,
} from "./clients";
import {
  followOnce,
  logoutCall,
  restCall,
  signUpCall,
  storageDownload,
  storageList,
  storageUpload,
  totpEnrol,
  totpVerify,
  type HttpEnv,
} from "./http";
import { readNewestMail, type MailDeps } from "./mail";
import type { Env, SpikeTargetName } from "./target";
import { runT1, type T1Deps } from "./t1";
import { runT2, shapeOf, type PayloadShape, type RealtimeAnswer, type T2Deps } from "./t2";
import { runT3, type SwitchAnswer, type T3Deps } from "./t3";
import { runT5, type T5Deps } from "./t5";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const newPassword = () => randomBytes(32).toString("base64url");

/** supabase-js reports a dropped connection as status 0 or no status: that is not an answer, so it is thrown (the check reports it as inconclusive). */
function answered(error: AuthError | null): number | null {
  if (error === null) return null;
  if (error.status === undefined || error.status === 0) throw error;
  return error.status;
}

function toAuthResult(
  data: { session: { access_token: string; refresh_token: string } | null },
  error: AuthError | null,
): AuthResult {
  const status = answered(error);
  return {
    status: error === null ? 200 : status,
    code: error?.code ?? null,
    session:
      data.session === null
        ? null
        : { accessToken: data.session.access_token, refreshToken: data.session.refresh_token },
  };
}

async function listAllUsers(
  admin: SupabaseClient,
  visit: (user: { id: string; email?: string }) => boolean,
): Promise<void> {
  for (let page = 1; page <= 200; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) if (visit(user)) return;
    if (data.users.length < 200) return;
  }
  throw new Error("More than 40000 auth users: the spike's look-ups stop here.");
}

export function buildAuthContext(input: {
  target: SpikeTargetName;
  env: Env;
  fetchImpl?: typeof fetch;
}): AuthContext {
  const { target } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  const spikeEnv: SpikeEnv = readSpikeEnv(input.env);
  const http: HttpEnv = {
    supabaseUrl: spikeEnv.supabaseUrl,
    publishableKey: spikeEnv.publishableKey,
    fetchImpl,
  };
  const admin = createAdminClient(spikeEnv, fetchImpl);
  const anon = () => createUserClient(spikeEnv, null, fetchImpl);
  const mailpitUrl = input.env.E2E_MAILPIT_URL;
  const mail = (): MailDeps => {
    if (mailpitUrl === undefined || mailpitUrl === "")
      throw new Error("E2E_MAILPIT_URL is not set.");
    return { mailpitUrl, fetchImpl, sleep, attempts: 40, pollMs: 500 };
  };

  const findUserIdByEmail = async (email: string): Promise<string | null> => {
    let found: string | null = null;
    await listAllUsers(admin, (user) => {
      if (user.email === email) found = user.id;
      return found !== null;
    });
    return found;
  };
  const deleteUser = async (id: string) => admin.auth.admin.deleteUser(id);
  const createUser = async (email: string, password: string) => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    return {
      id: data.user?.id ?? null,
      status: error === null ? 200 : answered(error),
      code: error?.code ?? null,
    };
  };
  const generateLink = async (email: string) => {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    return {
      status: error === null ? 200 : answered(error),
      code: error?.code ?? null,
      emailOtp: data.properties?.email_otp ?? null,
      actionLink: data.properties?.action_link ?? null,
    };
  };
  const verifyEmailCode = async (email: string, token: string): Promise<AuthResult> => {
    const { data, error } = await anon().auth.verifyOtp({ email, token, type: "email" });
    return toAuthResult(data, error);
  };
  const passwordSignIn = async (email: string, password: string): Promise<AuthResult> => {
    const { data, error } = await anon().auth.signInWithPassword({ email, password });
    return toAuthResult(data, error);
  };
  const refresh = async (refreshToken: string): Promise<AuthResult> => {
    const { data, error } = await anon().auth.refreshSession({ refresh_token: refreshToken });
    return toAuthResult(data, error);
  };
  const sendCode = async (email: string): Promise<void> => {
    const { error } = await anon().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    const status = answered(error);
    if (status !== null)
      throw new Error(`Auth refused to send the sign-in code (status ${status}).`);
  };
  const totpCode = (secret: string) => totpAt(secret, Math.floor(Date.now() / 1000));
  const t5Deps: T5Deps = {
    signUp: (email, password) => signUpCall(http, email, password),
    otpForUnknown: async (email) => {
      const { error } = await anon().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      return {
        status: error === null ? 200 : (answered(error) ?? 0),
        code: error?.code ?? null,
        accepted: error === null,
      };
    },
    anonymous: async () => {
      const { data, error } = await anon().auth.signInAnonymously();
      return {
        status: error === null ? 200 : (answered(error) ?? 0),
        code: error?.code ?? null,
        userId: data.user?.id ?? null,
      };
    },
    countUsers: async () => {
      let count = 0;
      await listAllUsers(admin, () => {
        count += 1;
        return false;
      });
      return count;
    },
    findUserIdByEmail,
    deleteUser,
    createTenant: (tenantInput) => createTenant(admin, tenantInput),
    sendCode,
    mailCode: async (email) => {
      const read = await readNewestMail(mail(), email, []);
      if (read.code === null) throw new Error("The sign-in mail has no code.");
      return read.code;
    },
    generateCode: async (email) => {
      const link = await generateLink(email);
      if (link.emailOtp === null) throw new Error("generateLink gave no code.");
      return link.emailOtp;
    },
    verifyCode: async (email, code) => {
      const { data, error } = await anon().auth.verifyOtp({ email, token: code, type: "email" });
      const status = error === null ? 200 : (answered(error) ?? 0);
      return { status, claims: data.session === null ? null : claimsOf(data.session.access_token) };
    },
    newId: randomUUID,
  };

  const memoryStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
  };

  const t1Deps: T1Deps = {
    createUser,
    deleteUser,
    passwordSignIn,
    refresh,
    sendCode,
    mailMessage: (email, knownIds) => readNewestMail(mail(), email, knownIds),
    generateLink,
    verifyEmailCode,
    pkceStart: async (email) => {
      const client = createClient(spikeEnv.supabaseUrl, spikeEnv.publishableKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: memoryStorage(),
        },
        global: { fetch: fetchImpl },
      });
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      const status = answered(error);
      if (status !== null) return { handle: null, status, code: error?.code ?? null };
      return { handle: client, status: 200, code: null };
    },
    sleep,
    followRedirect: (url) => followOnce(fetchImpl, url),
    pkceExchange: async (handle, code) => {
      const { data, error } = await (handle as SupabaseClient).auth.exchangeCodeForSession(code);
      return toAuthResult(data, error);
    },
    enrolTotp: (accessToken) => totpEnrol(http, accessToken, `sp0-${randomUUID().slice(0, 8)}`),
    verifyTotp: (accessToken, factorId, code) => totpVerify(http, accessToken, factorId, code),
    totpCode,
    newId: randomUUID,
    newPassword,
  };

  const t2Deps: T2Deps = {
    createTenant: (tenantInput) => createTenant(admin, tenantInput),
    setOwnerPassword: async (email, password) => {
      const id = await findUserIdByEmail(email);
      if (id === null) return { error: new Error("owner not found") };
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      return { error };
    },
    passwordSignIn,
    refresh,
    rest: (token, method, path, body) => restCall(http, token, method, path, body),
    upload: (token, path) => storageUpload(http, token, path),
    storage: (token, op, path) =>
      op === "list" ? storageList(http, token, path) : storageDownload(http, token, path),
    signOut: (token) => logoutCall(http, token),
    realtimeProbe: async ({ consoleToken, ownerToken, insert }): Promise<RealtimeAnswer> => {
      const state = {
        owner: { join: "pending", shapes: [] as PayloadShape[] },
        console: { join: "pending", shapes: [] as PayloadShape[] },
      };
      const clients: SupabaseClient[] = [];
      const subscribe = (label: "owner" | "console", token: string) => {
        const client = createUserClient(spikeEnv, null, fetchImpl);
        clients.push(client);
        client.realtime.setAuth(token);
        client
          .channel(`sp0-${label}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "sp0_rt_probe" },
            (payload) => {
              state[label].shapes.push(shapeOf(payload));
            },
          )
          .subscribe((status) => {
            // The first settled status is the answer; the teardown's CLOSED (removeAllChannels below) must not overwrite it.
            if (state[label].join === "pending") state[label].join = status;
          });
      };
      subscribe("owner", ownerToken);
      subscribe("console", consoleToken);
      for (
        let waited = 0;
        waited < 10_000 && (state.owner.join === "pending" || state.console.join === "pending");
        waited += 250
      ) {
        await sleep(250);
      }
      // Realtime registers a postgres_changes subscription shortly after the join is acknowledged: give it a moment before the insert.
      if (state.owner.join === "SUBSCRIBED" || state.console.join === "SUBSCRIBED")
        await sleep(2000);
      await insert();
      await sleep(5000);
      await Promise.all(clients.map((client) => client.removeAllChannels()));
      return {
        ownerJoin: state.owner.join,
        consoleJoin: state.console.join,
        owner: state.owner.shapes,
        console: state.console.shapes,
      };
    },
    newId: randomUUID,
    newPassword,
  };

  const t3Deps: T3Deps = {
    createTenant: (tenantInput) => createTenant(admin, tenantInput),
    createUser,
    addMembership: async (tenantId, authId, role, displayName) => {
      const { error, status } = await admin
        .from("app_user")
        .insert({ tenant_id: tenantId, auth_id: authId, role, display_name: displayName });
      return { status, code: error?.code ?? null };
    },
    passwordSignIn,
    refresh,
    enrolTotp: (accessToken) => totpEnrol(http, accessToken, `sp0-${randomUUID().slice(0, 8)}`),
    verifyTotp: (accessToken, factorId, code) => totpVerify(http, accessToken, factorId, code),
    totpCode,
    // The shape of a route handler: one server client with a cookie jar; select the tenant, then one refresh; the jar holds the new token.
    switchTenant: async (session, tenantId): Promise<SwitchAnswer> => {
      const jar = new Map<string, string>();
      const client = createServerClient(spikeEnv.supabaseUrl, spikeEnv.publishableKey, {
        global: { fetch: fetchImpl },
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookies) => {
            for (const cookie of cookies) {
              if (cookie.value === "") jar.delete(cookie.name);
              else jar.set(cookie.name, cookie.value);
            }
          },
        },
      });
      const set = await client.auth.setSession({
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
      });
      if (set.error) throw set.error;
      const started = performance.now();
      const selected = await client.rpc("sp0_select_tenant", { p_tenant: tenantId });
      const refreshed = await client.auth.refreshSession();
      const wallMs = Math.round(performance.now() - started);
      const claims = await client.auth.getClaims();
      return {
        select: { status: selected.status, code: selected.error?.code ?? null },
        refresh: toAuthResult(refreshed.data, refreshed.error),
        getClaims: (claims.data?.claims as Record<string, unknown> | undefined) ?? null,
        wallMs,
      };
    },
    rest: (token, method, path, body) => restCall(http, token, method, path, body),
    newId: randomUUID,
    newPassword,
  };

  return {
    secrets: secretsToRedact(spikeEnv),
    preflight: () => preflight(admin),
    authVersion: () => readAuthVersion(fetchImpl, spikeEnv.supabaseUrl, spikeEnv.publishableKey),
    checks: {
      t1: (pre) => runT1(t1Deps, target, pre),
      t2: (pre) => runT2(t2Deps, target, pre),
      t3: (pre) => runT3(t3Deps, target, pre),
      t5: (pre) => runT5(t5Deps, target, pre),
    },
  };
}
