import type { SupabaseClient } from "@supabase/supabase-js";
import { COUNT_LIST_PAGE_SIZE } from "./constants";
import { mapCountDbError } from "./errors";
import { countSession, countSessionDetail, countSessionsResponse } from "./output";
import type { CountStartBody, TimeCursor } from "./schemas";
import type { CountPerson, CountSession, CountSessionDetail, CountSessionsResult } from "./types";

type RawSession = Omit<CountSession, "startedBy" | "closedBy"> & {
  startedBy: CountPerson;
  closedBy: CountPerson | null;
};

const person = (p: CountPerson) => ({ name: p.name, me: p.me });

/** A session of the RPC, field by field: nothing the API does not declare gets through. */
export function mapSession(s: RawSession): CountSession {
  return countSession.parse({
    id: s.id,
    type: s.type,
    status: s.status,
    location: { id: s.location.id, name: s.location.name },
    startedAt: s.startedAt,
    startedBy: person(s.startedBy),
    closedAt: s.closedAt,
    closedBy: s.closedBy ? person(s.closedBy) : null,
    cancelledAt: s.cancelledAt,
    linesTotal: s.linesTotal,
    linesCounted: s.linesCounted,
    linesWithDifference: s.linesWithDifference,
  });
}

function mapDetail(s: CountSessionDetail): CountSessionDetail {
  return countSessionDetail.parse({
    ...mapSession(s),
    ...(s.resumed === undefined ? {} : { resumed: s.resumed }),
    today: s.today,
    invoicesAwaitingApproval: s.invoicesAwaitingApproval,
    lines: s.lines.map((l) => ({
      ingredientId: l.ingredientId,
      name: l.name,
      baseUnit: l.baseUnit,
      position: l.position,
      expectedNowQty: l.expectedNowQty,
      expectedQty: l.expectedQty,
      countedQty: l.countedQty,
      differenceQty: l.differenceQty,
      enteredAt: l.enteredAt,
    })),
  });
}

interface SessionsRpc {
  sessions: RawSession[];
  nextCursor: { at: string; id: string } | null;
}

/** GET /api/counts: the sessions, newest first, a page at a time. */
export async function listCounts(
  supabase: SupabaseClient,
  query: { status: string; before: TimeCursor | null },
): Promise<CountSessionsResult> {
  const { data, error } = await supabase.rpc("count_sessions", {
    p_status: query.status,
    p_before_at: query.before?.at ?? null,
    p_before_id: query.before?.id ?? null,
    p_limit: COUNT_LIST_PAGE_SIZE,
  });
  if (error) throw mapCountDbError(error);
  const result = data as SessionsRpc;
  return countSessionsResponse.parse({
    sessions: result.sessions.map(mapSession),
    nextCursor: result.nextCursor ? `${result.nextCursor.at}_${result.nextCursor.id}` : null,
  });
}

/** POST /api/counts: starts a count, or resumes the open one of the same type (resumed true). */
export async function startCount(
  supabase: SupabaseClient,
  body: CountStartBody,
): Promise<CountSessionDetail> {
  const { data, error } = await supabase.rpc("count_start", {
    p_type: body.type,
    p_location: body.locationId ?? null,
  });
  if (error) throw mapCountDbError(error);
  return mapDetail(data as CountSessionDetail);
}

/** GET /api/counts/:id: the session with its lines and the reminders. */
export async function getCount(supabase: SupabaseClient, id: string): Promise<CountSessionDetail> {
  const { data, error } = await supabase.rpc("count_session_view", { p_session: id });
  if (error) throw mapCountDbError(error);
  return mapDetail(data as CountSessionDetail);
}
