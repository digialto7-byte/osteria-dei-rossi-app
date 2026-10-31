import { describe, expect, it } from "vitest";
import { markLineBody, markTicketBody } from "@/server/kitchen/schemas";
import { KIDS } from "../../helpers/kitchen-data";

const ticketBody = {
  sessionId: KIDS.session,
  firedAt: "2026-11-04T19:31:00.000000Z",
  course: "secondi",
  segue: false,
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
  it("accepts the five fields of a comanda", () => {
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

  it("rejects an unknown course, a missing segue and a bad session id", () => {
    expect(markTicketBody.safeParse({ ...ticketBody, course: "pizze" }).success).toBe(false);
    const { segue: _segue, ...withoutSegue } = ticketBody;
    expect(markTicketBody.safeParse(withoutSegue).success).toBe(false);
    expect(markTicketBody.safeParse({ ...ticketBody, sessionId: "nope" }).success).toBe(false);
    expect(markTicketBody.safeParse({ ...ticketBody, segue: "false" }).success).toBe(false);
    expect(markTicketBody.safeParse({ ...ticketBody, extra: 1 }).success).toBe(false);
  });
});
