// SP0 spike: connects the T4 seed to the real clients. Thin glue (see wiring.ts): the logic it calls is unit-tested with fakes and this file is proven by
// the CI workflow and the run day. The demo seed gets the spike's own clients: the admin client of clients.ts (secret key on `apikey` only) and
// user clients on the publishable key.
import { randomBytes, randomUUID } from "node:crypto";
import { romeToday } from "../demo/dates";
import { buildFixture } from "../demo/fixture";
import { buildPurgeDeps, buildSeedDeps } from "../demo/main";
import { runSeed } from "../demo/seed";
import { createTenant } from "../create-tenant";
import {
  createAdminClient,
  createUserClient,
  preflight,
  readSpikeEnv,
  secretsToRedact,
} from "./clients";
import type { AuthResult } from "./common";
import { restCall, type HttpEnv } from "./http";
import type { Env, SpikeTargetName } from "./target";
import { runT4Seed } from "./t4-seed";
import type { SeedContext } from "./t4-seed-entry";

// clientUpdatedAt may not run ahead of the server's clock: stamp a little in the past, as the order-entry measurement does.
const STAMP_LAG_MS = 5_000;

export function buildSeedContext(input: {
  target: SpikeTargetName;
  env: Env;
  fetchImpl?: typeof fetch;
}): SeedContext {
  const fetchImpl = input.fetchImpl ?? fetch;
  const spikeEnv = readSpikeEnv(input.env);
  const http: HttpEnv = {
    supabaseUrl: spikeEnv.supabaseUrl,
    publishableKey: spikeEnv.publishableKey,
    fetchImpl,
  };
  const admin = createAdminClient(spikeEnv, fetchImpl);
  const now = () => new Date();

  return {
    secrets: secretsToRedact(spikeEnv),
    preflight: () => preflight(admin),
    seed: (pre) =>
      runT4Seed(
        {
          createTenant: (tenantInput) => createTenant(admin, tenantInput),
          runSeed: (tenantId) =>
            runSeed(
              buildSeedDeps(
                admin,
                buildPurgeDeps(admin),
                spikeEnv.supabaseUrl,
                spikeEnv.publishableKey,
                now,
              ),
              buildFixture(romeToday(now())),
              {
                tenantId,
                reset: false,
                force: false,
              },
            ),
          createWaiter: async (tenantId) => {
            const id = randomUUID().slice(0, 8);
            const email = `sp0-waiter-${id}@example.test`;
            const password = randomBytes(32).toString("base64url");
            const made = await admin.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
            });
            if (made.error || made.data.user === null)
              throw new Error("creating the waiter failed");
            const member = await admin.from("app_user").insert({
              tenant_id: tenantId,
              auth_id: made.data.user.id,
              role: "waiter",
              display_name: "SP0 Waiter",
            });
            if (member.error) throw new Error("adding the waiter failed");
            return { email, password };
          },
          waiterSignIn: async (email, password): Promise<AuthResult> => {
            const { data, error } = await createUserClient(
              spikeEnv,
              null,
              fetchImpl,
            ).auth.signInWithPassword({ email, password });
            return {
              status: error === null ? 200 : (error.status ?? null),
              code: error?.code ?? null,
              session:
                data.session === null
                  ? null
                  : {
                      accessToken: data.session.access_token,
                      refreshToken: data.session.refresh_token,
                    },
            };
          },
          rest: (token, method, path, body) => restCall(http, token, method, path, body),
          newId: randomUUID,
          stamp: () => new Date(Date.now() - STAMP_LAG_MS).toISOString(),
        },
        input.target,
        pre,
      ),
  };
}
