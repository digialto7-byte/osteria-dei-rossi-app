import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";
import { IDS, SESSION } from "../../helpers/menu-tables-data";
import {
  ACTION_RESULT,
  RESERVATION_1,
  SEATABLE_DETAIL,
  SESSION_1,
  TABLE_1,
} from "../../helpers/reservations-data";
import { seatReservation } from "@/server/reservations/seat";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const BODY = { sessionId: SESSION_1, covers: 6 };
const OPEN = { created: true, session: { ...SESSION, id: SESSION_1, tableId: TABLE_1 } };

function client(rpc: Record<string, FakeResult[]> = {}) {
  return fakeSupabase({
    rpc: {
      reservation_detail: [ok(SEATABLE_DETAIL)],
      open_table: [ok(OPEN)],
      seat_reservation: [ok({ ...ACTION_RESULT, status: "seated", sessionId: SESSION_1 })],
      ...rpc,
    },
  });
}
const order = (c: ReturnType<typeof client>) => c.rpc.mock.calls.map((call: unknown[]) => call[0]);

describe("seatReservation", () => {
  it("reads the detail, opens the lead table, then seats, in that order", async () => {
    const c = client();
    const result = await seatReservation(
      c as unknown as SupabaseClient,
      "owner",
      RESERVATION_1,
      BODY,
    );
    expect(result).toEqual({ sessionId: SESSION_1, created: true });
    expect(order(c)).toEqual(["reservation_detail", "open_table", "seat_reservation"]);
    expect(c.rpc).toHaveBeenNthCalledWith(2, "open_table", {
      p_table: TABLE_1,
      p_session: SESSION_1,
      p_covers: 6,
    });
  });

  it("a failed open_table stops before seat_reservation", async () => {
    const c = client({
      open_table: [{ data: null, error: { code: "P0001", message: "table_inactive" } }],
    });
    await expect(
      seatReservation(c as unknown as SupabaseClient, "owner", RESERVATION_1, BODY),
    ).rejects.toMatchObject({
      status: 422,
      code: "table_inactive",
    });
    expect(order(c)).toEqual(["reservation_detail", "open_table"]);
  });

  it("a failed seat_reservation after a created session is reported, and the retry replays open_table", async () => {
    const failing = client({
      seat_reservation: [{ data: null, error: { code: "P0001", message: "session_closed" } }],
    });
    await expect(
      seatReservation(failing as unknown as SupabaseClient, "owner", RESERVATION_1, BODY),
    ).rejects.toMatchObject({
      status: 409,
      code: "session_closed",
    });
    const retry = client({ open_table: [ok({ ...OPEN, created: false })] });
    await expect(
      seatReservation(retry as unknown as SupabaseClient, "owner", RESERVATION_1, BODY),
    ).resolves.toEqual({
      sessionId: SESSION_1,
      created: false,
    });
    expect(order(retry)).toEqual(["reservation_detail", "open_table", "seat_reservation"]);
  });

  it("another session id on the same booking cannot slip through a replay", async () => {
    const c = client({
      reservation_detail: [
        ok({
          ...SEATABLE_DETAIL,
          status: "seated",
          sessionId: IDS.session1,
          actions: ["split", "erase"],
        }),
      ],
    });
    await expect(
      seatReservation(c as unknown as SupabaseClient, "owner", RESERVATION_1, BODY),
    ).rejects.toMatchObject({
      status: 409,
      code: "status_invalid",
    });
    expect(order(c)).toEqual(["reservation_detail"]);
  });
});
