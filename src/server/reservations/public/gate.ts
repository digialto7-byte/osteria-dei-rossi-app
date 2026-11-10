import "server-only";
import { createHmac } from "node:crypto";

// The route gate of the five anon functions (ADR-032 decision 1). The SQL (app.reservation_gate_ok) checks the same MAC with extensions.hmac against Vault
// `reservation_gate_key`, within 60 seconds, so only our routes, which hold RESERVATION_GATE_KEY, can call them.

export const GATE_FUNCTIONS = [
  "reservation_page",
  "reservation_slots",
  "request_reservation",
  "reservation_cancel_view",
  "cancel_reservation",
] as const;
export type GateFunction = (typeof GATE_FUNCTIONS)[number];

/** HMAC-SHA256 over `resv-gate|v1|<function>|<slug>|<ts>`, as 64 lower-case hex characters. */
export function gateMac(key: string, fn: GateFunction, slug: string, ts: number): string {
  return createHmac("sha256", key).update(`resv-gate|v1|${fn}|${slug}|${ts}`).digest("hex");
}

/** The first three arguments of every anon RPC. `nowMs` is the clock, passed in so a test can fix it. */
export function gateArgs(key: string, fn: GateFunction, slug: string, nowMs: number) {
  const ts = Math.floor(nowMs / 1000);
  return { p_slug: slug, p_gate_ts: ts, p_gate_mac: gateMac(key, fn, slug, ts) };
}
