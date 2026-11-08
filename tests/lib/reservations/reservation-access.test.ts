import { describe, expect, it } from "vitest";
import { canUseReservations } from "@/lib/reservations/reservation-access";

describe("canUseReservations (mirrors GET /api/reservations)", () => {
  it("owner, admin and waiter; never the chef or an unknown role", () => {
    for (const role of ["owner", "admin", "waiter"])
      expect(canUseReservations(role), role).toBe(true);
    for (const role of ["chef", "", "guest"]) expect(canUseReservations(role), role).toBe(false);
  });
});
