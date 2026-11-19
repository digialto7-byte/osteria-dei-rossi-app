import { describe, expect, it } from "vitest";
import { markLineBody, markTicketBody } from "@/server/kitchen/schemas";
import { KIDS } from "../../helpers/kitchen-data";

const ticketBody = {
  sessionId: KIDS.session,
  firedAt: "2026-11-04T19:31:00.000000Z",
  uscita: 2,
  closed: true,
};

describe("markLineBody (M19b)", () => {
  it("accepts a boolean target state", () => {
    expect(markLineBody.parse({ done: true })).toEqual({ done: true });
    expect(markLineBody.parse({ done: false })).toEqual({ done: false });
  });

  it.each([{}, { done: "true" }, { done: 1 }, { done: null }, { done: true, extra: 1 }, []])(
    "rejects %j",
    (body) => {
      expect(markLineBody.safeParse(body).success).toBe(false);
    },
  );
});

describe("markTicketBody (M19b)", () => {
  it("accepts the four fields of an uscita ticket", () => {
    expect(markTicketBody.parse(ticketBody)).toEqual(ticketBody);
  });

  it("rejects a firedAt with three decimals, no Z or an offset", () => {
    for (const firedAt of [
      "2026-11-04T19:31:00.123Z",
      "2026-11-04T19:31:00.123456",
      "2026-11-04T19:31:00.123456+01:00",
      "x",
    ]) {
      expect(markTicketBody.safeParse({ ...ticketBody, firedAt }).success, firedAt).toBe(false);
    }
  });

  it("requires uscita and refuses course or segue (comanda per uscita, plan 2026-11-18 §3.9)", () => {
    const { uscita: _u, ...withoutUscita } = ticketBody;
    expect(markTicketBody.safeParse(withoutUscita).success).toBe(false);
    expect(markTicketBody.safeParse({ ...ticketBody, course: "secondi" }).success).toBe(false);
    expect(markTicketBody.safeParse({ ...ticketBody, segue: false }).success).toBe(false);
    expect(
      markTicketBody.safeParse({ ...withoutUscita, course: "secondi", segue: false }).success,
    ).toBe(false);
  });

  it("refuses an uscita outside 0..9, not an integer or a string, a bad session id and an extra key", () => {
    for (const uscita of [-1, 10, 1.5, "2", null]) {
      expect(markTicketBody.safeParse({ ...ticketBody, uscita }).success, String(uscita)).toBe(
        false,
      );
    }
    expect(markTicketBody.safeParse({ ...ticketBody, uscita: 0 }).success).toBe(true);
    expect(markTicketBody.safeParse({ ...ticketBody, sessionId: "nope" }).success).toBe(false);
    expect(markTicketBody.safeParse({ ...ticketBody, closed: "true" }).success).toBe(false);
    expect(markTicketBody.safeParse({ ...ticketBody, extra: 1 }).success).toBe(false);
  });
});
