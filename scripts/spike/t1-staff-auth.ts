// T1 spike (M11 plan step 0, AT8): runs against the LOCAL Supabase stack (`npx supabase start`).
//   npx tsx scripts/spike/t1-staff-auth.ts
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and,
// for check (b), E2E_MAILPIT_URL in the environment. Prints one JSON line (no secrets) and exits 1
// if any check fails. It refuses a non-local URL; staging needs the founder's OK (plan M-1).
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatReport, resolveTarget, runSpike, type SpikeDeps } from "../lib/t1-staff-auth";

const STAFF_MAIL = /@staff\.invalid$/i;

async function staffMailCounter(mailpitUrl: string): Promise<number> {
  const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error(`mail catcher answered ${response.status}`);
  const body = (await response.json()) as { messages?: { To?: { Address: string }[] | null }[] };
  return (body.messages ?? []).filter((m) => (m.To ?? []).some((to) => STAFF_MAIL.test(to.Address)))
    .length;
}

try {
  const env = readPublicEnv();
  const target = resolveTarget({
    argv: process.argv.slice(2),
    env: process.env,
    supabaseUrl: env.supabaseUrl,
  });
  const admin = createSupabaseAdminClient();
  // A fresh, session-less client per call: each sign-in is an independent server-side request.
  const anon = () =>
    createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const mailpit = process.env.E2E_MAILPIT_URL;

  const deps: SpikeDeps = {
    admin: admin.auth.admin,
    signIn: async (email, password) => {
      const { data, error } = await anon().auth.signInWithPassword({ email, password });
      return { session: data.session, error };
    },
    refresh: async (refreshToken) => {
      const { data, error } = await anon().auth.refreshSession({ refresh_token: refreshToken });
      return { session: data.session, error };
    },
    staffMailCount: mailpit ? () => staffMailCounter(mailpit) : null,
    findUserIdByEmail: async (email) => {
      for (let page = 1; page <= 50; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const hit = data.users.find((user) => user.email === email);
        if (hit) return hit.id;
        if (data.users.length < 200) return null;
      }
      return null;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newId: randomUUID,
    newPassword: () => randomBytes(32).toString("base64url"),
  };

  const report = await runSpike(deps, target);
  console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  // Name only: the message of a config error lists variable names, never values, but keep it terse.
  console.error(error instanceof Error ? error.message : "t1 spike failed");
  process.exit(1);
}
